"""The scripted half of docs/user-tests.md, against a local server.

Run from api/ with its virtualenv, against a freshly seeded database:

    .venv/bin/python -I ../scripts/user_tests_api.py

It prints one line per test ID (PASS/FAIL + detail) and a total. It writes
to the database it points at, so never point it at production.
"""

import io
import json
import time
import zipfile

import httpx

B = "http://127.0.0.1:8001/api/v1"
R = []  # (id, ok, detail)


def rec(tid, ok, detail=""):
    R.append((tid, bool(ok), detail))


c = httpx.Client(base_url=B, timeout=30, headers={"X-TripStash-Timezone": "Asia/Jerusalem"})


def login(email, password):
    r = c.post("/auth/login", json={"email": email, "password": password})
    return r


# ---- 1. sign in
r = login("traveller@example.com", "tripstash-demo-password")
rec("A1", r.status_code == 200, f"{r.status_code}")
TOKEN = r.json()["access_token"]
H = {"Authorization": f"Bearer {TOKEN}"}
c.headers.update(H)

r = login("traveller@example.com", "wrong-password-here")
rec("A2", r.status_code == 401 and "detail" in r.json(), f"{r.status_code} {r.text[:80]}")

bad = httpx.Client(base_url=B, headers={"Authorization": "Bearer nope"}, timeout=10)
r = bad.get("/trips/current")
rec("A6/X5", r.status_code == 401, f"{r.status_code}")

# A4/A5 new account + trip
r = httpx.post(f"{B}/auth/register", json={"email": "tester-fresh@example.com", "password": "a-long-password-123", "display_name": "T"})
rec("A4", r.status_code == 201, f"{r.status_code} {r.text[:80]}")
fresh = httpx.Client(base_url=B, headers={"Authorization": f"Bearer {r.json().get('access_token','')}"}, timeout=10)
r = fresh.get("/trips/current")
rec("A5a", r.status_code == 404, f"no trip yet → {r.status_code}")
r = fresh.post("/trips", json={"name": "Test trip"})
rec("A5b", r.status_code == 201, f"{r.status_code}")
r = fresh.get("/trips/current/route")
rec("A5c", r.status_code == 200 and r.json()["stops"] == [], f"{r.status_code} stops={len(r.json().get('stops',[]))}")
r = fresh.get("/home")
rec("D9/home-empty", r.status_code == 200, f"{r.status_code}")
r = fresh.get("/explore/countries")
rec("D9/explore-empty", r.status_code == 200 and r.json() == [], f"{r.status_code} {r.text[:60]}")
r = fresh.get("/trips/current/checks")
rec("D9/checks-empty", r.status_code == 200 and r.json() == [], f"{r.status_code}")
r = fresh.get("/trips/current/suggestions")
rec("D9/suggest-empty", r.status_code == 200, f"{r.status_code}")
r = fresh.get("/trips/current/discover")
rec("D9/discover-empty", r.status_code == 200, f"{r.status_code}")

# ---- 13. latency
for path in ["/trips/current/route", "/explore/countries", "/home", "/places", "/trips/current/checks",
             "/trips/current/suggestions", "/reels/spots", "/countries/guatemala/cities", "/inbox", "/sources"]:
    t = time.perf_counter(); r = c.get(path); ms = (time.perf_counter() - t) * 1000
    rec(f"F3 {path}", r.status_code == 200 and ms < 300, f"{r.status_code} {ms:.0f} ms")
t = time.perf_counter(); r = c.get("/trips/current/discover"); ms = (time.perf_counter() - t) * 1000
rec("F4 discover", r.status_code == 200, f"{r.status_code} {ms:.0f} ms live={r.json().get('live')}")

# ---- 2. trip
route = c.get("/trips/current/route").json()
stops = route["stops"]
rec("T8", route["total_nights"] == sum(s["nights"] or 0 for s in stops) and len(stops) == 20, f"{len(stops)} stops {route['total_nights']} nights {route['start_date']}→{route['end_date']}")
first, second = stops[0], stops[1]
r = c.patch(f"/trips/current/destinations/{first['destination']['id']}", json={"nights": first["nights"] + 1})
nr = r.json()
rec("T9", r.status_code == 200 and nr["stops"][1]["arrive_on"] > second["arrive_on"] and nr["end_date"] > route["end_date"], f"2nd arrive {second['arrive_on']}→{nr['stops'][1]['arrive_on']}, end {route['end_date']}→{nr['end_date']}")
c.patch(f"/trips/current/destinations/{first['destination']['id']}", json={"nights": first["nights"]})
r = c.patch(f"/trips/current/destinations/{first['destination']['id']}", json={"nights": 0})
rec("T10", r.status_code == 200 and r.json()["stops"][0]["nights"] == 0 and r.json()["stops"][0]["arrive_on"] == r.json()["stops"][0]["depart_on"], f"{r.status_code}")
c.patch(f"/trips/current/destinations/{first['destination']['id']}", json={"nights": first["nights"]})
r = c.patch(f"/trips/current/destinations/{first['destination']['id']}", json={"nights": 400})
rec("X8", r.status_code == 422, f"{r.status_code} {r.text[:80]}")
r = c.patch(f"/trips/current/destinations/{first['destination']['id']}", json={"nights": None})
rec("T11", r.status_code == 200 and r.json()["has_end_date"] is False and r.json()["stops"][1]["arrive_on"] is None, f"has_end={r.json().get('has_end_date')}")
c.patch(f"/trips/current/destinations/{first['destination']['id']}", json={"nights": first["nights"]})

# T12/T13/T14 add stop like the UI does (name only)
n0 = len(stops)
r = c.post("/trips/current/destinations", json={"name": "Flores", "after_position": stops[5]["destination"]["position"]})
rec("T12", r.status_code == 201, f"{r.status_code}")
flores = r.json()
route2 = c.get("/trips/current/route").json()
idx = [s["destination"]["id"] for s in route2["stops"]].index(flores["id"])
rec("T12b", idx == 6 and len(route2["stops"]) == n0 + 1, f"inserted at index {idx}")
rec("N1/N2 coords", flores.get("lat") is not None and flores.get("country"), f"UI-style add: lat={flores.get('lat')} country={flores.get('country')!r}")
rec("N6 leg", route2["stops"][idx]["leg_in"] and route2["stops"][idx]["leg_in"]["distance_km"] is not None, f"leg_in={route2['stops'][idx]['leg_in']}")
r = c.post("/trips/current/destinations", json={"name": ""})
rec("T14", r.status_code == 422, f"{r.status_code}")
r = c.post("/trips/current/destinations", json={"name": "x" * 161})
rec("X3", r.status_code == 422, f"161 chars → {r.status_code}")
r = c.post("/trips/current/destinations", json={"name": "Cartagena", "country": "Colombia"})
cart = r.json(); rec("N1 end", r.status_code == 201, f"{r.status_code}")
r = c.post("/trips/current/destinations", json={"name": "Xyzzyville"})
xyz = r.json(); rec("N8", r.status_code == 201, f"{r.status_code} lat={xyz.get('lat')}")
r = c.get("/trips/current/route"); rec("N8 route ok", r.status_code == 200, f"{r.status_code}")
r = c.get("/trips/current/checks"); rec("N6 checks", r.status_code == 200, f"{[x['kind'] for x in r.json()]}")
r = c.get("/explore/countries"); rec("N3", r.status_code == 200, f"countries={[x['name'] for x in r.json()]}")
r = c.get("/countries/colombia/cities"); rec("N4", r.status_code == 200, f"{r.status_code} {r.text[:60]}")
r = c.get("/explore/cities", params={"country": "Colombia"}); rec("N4b", r.status_code == 200, f"{r.status_code}")
for d in (flores, cart, xyz):
    c.delete(f"/trips/current/destinations/{d['id']}")
r = c.get("/trips/current/route"); rec("N7", len(r.json()["stops"]) == n0 and r.json()["end_date"] == route["end_date"], f"{len(r.json()['stops'])} stops, end {r.json()['end_date']}")

# T22/T23 alternatives
oax = stops[1]["destination"]["id"]
r = c.patch(f"/trips/current/destinations/{oax}", json={"on_route": False})
rec("T22", r.status_code == 200 and [a["name"] for a in r.json()["alternatives"]] == ["Oaxaca"] and len(r.json()["stops"]) == 19, f"{r.status_code}")
r = c.patch(f"/trips/current/destinations/{oax}", json={"on_route": True})
rec("T23", r.status_code == 200 and r.json()["stops"][1]["nights"] == stops[1]["nights"] and r.json()["alternatives"] == [], f"{r.status_code}")

# T16/T17/T19/T21
r = c.get("/trips/current/suggestions", params={"after": stops[3]["destination"]["id"]})
rec("T16/I4", r.status_code == 200, f"{[(s['name'], s['detour_km']) for s in r.json()][:4]}")
r = c.get("/trips/current/discover", params={"after": stops[3]["destination"]["id"]})
dd = r.json(); rec("T17", r.status_code == 200 and set(dd) == {"gringo","web","reddit","youtube","live"}, f"live={dd.get('live')}")
r = c.get("/trips/current/checks"); ch = r.json()
carn = [x for x in ch if x["kind"] == "event_missed"]
rec("T19/I3", bool(carn) and carn[0]["fix"] and carn[0]["fix"]["payload"]["nights"] == 9, f"{[x['title'] for x in ch]}")
r = c.get("/recommend", params={"q": "Antigua"}); rec("T21", r.status_code == 200 and r.json()["cards"], f"{r.json().get('summary','')[:60]}")
r = c.get("/home"); rec("T24", r.status_code == 200, f"date={r.json().get('date')}")
r = c.get("/home", params={"lat": 14.55, "lon": -90.73}); rec("T24b", r.status_code == 200, f"{r.status_code}")

# ---- 3. explore
r = c.get("/countries/guatemala/cities"); cities = r.json()
rec("E7", all(k in cities[0] for k in ("photo_url", "explanation", "in_route")) and any(x["photo_url"] for x in cities), f"{[(x['name'], bool(x['photo_url'])) for x in cities]}")
r = c.get("/explore/cities", params={"country": "Guatemala", "sort": "places"}); rec("E9", r.status_code == 200, f"{r.status_code}")
r = c.get("/explore/cities", params={"country": "Nowhere"}); rec("E10", r.status_code == 200 and r.json() == [], f"{r.status_code} {r.text[:40]}")
r = c.post("/find", json={"place": "Colombia", "activity": "hike"}); fj = r.json()
rec("E3", r.status_code == 200 and "sources" in fj, f"found={fj.get('found')} had={fj.get('already_had')} src={len(fj.get('sources',[]))}")
r = c.post("/find", json={"place": "קולומביה"}); rec("E6", r.status_code == 200, f"{r.status_code}")
r = c.post("/find", json={"place": ""}); rec("E5", r.status_code == 422, f"{r.status_code}")

# ---- 4. clips
r = c.get("/reels/spots"); sp = r.json()
rec("C1", r.status_code == 200 and all("found_count" in s for s in sp), f"{len(sp)} spots")
# The demo plan holds no videos (the doc says so), so the feed is checked after
# a clip has been saved: see C3 below, after V1.
r = c.get("/reels"); rec("I2", r.status_code == 200 and sum(1 for x in r.json() if x.get("found")) == 0, f"found clips before any find: {sum(1 for x in r.json() if x.get('found'))}")

# ---- 5. saved
r = c.get("/inbox"); inbox = r.json(); rec("S3", r.status_code == 200, f"{len(inbox)} waiting")
if inbox:
    cand = inbox[0]
    r = c.post(f"/candidates/{cand['id']}/approve", json={}); rec("S4", r.status_code in (200, 201), f"{r.status_code} {r.text[:60]}")
    if len(inbox) > 1:
        r = c.post(f"/candidates/{inbox[1]['id']}/ignore"); rec("S5", r.status_code == 204, f"{r.status_code}")
r = c.get("/places"); rec("S6", r.status_code == 200 and r.json(), f"{len(r.json())} places")
r = c.get("/knowledge"); rec("S7", r.status_code == 200 and r.json(), f"{len(r.json())} items")
r = c.get("/sources"); srcs = r.json(); rec("S8", r.status_code == 200, f"{len(srcs)} sources")

# ---- 6. place
pl = c.get("/places").json()[0]
r = c.get(f"/places/{pl['trip_place_id']}"); rec("P1", r.status_code == 200 and "sources" in r.json() or "saved_content" in r.json(), f"{r.status_code} keys={list(r.json())[:8]}")
r = c.patch(f"/places/{pl['trip_place_id']}", json={"status": "must_visit"}); rec("P2", r.status_code == 200 and r.json()["status"] == "must_visit", f"{r.status_code}")
r = c.get("/places/nope"); rec("P4", r.status_code == 404, f"{r.status_code}")
r = fresh.get(f"/places/{pl['trip_place_id']}"); rec("X6", r.status_code == 404, f"other user → {r.status_code}")

# ---- 7. save
r = c.post("/sources", json={"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "text": "Go to Cerro de la Cruz at sunset in Antigua."}); rec("V1", r.status_code == 201, f"{r.status_code} {r.text[:60]}")
clip_source = r.json().get("id") if r.status_code == 201 else None
# C3: extraction runs after the response, so wait for the candidate, keep it,
# and the clip appears in the feed at its saved second.
cand = None
for _ in range(20):
    cand = next((x for x in c.get("/inbox").json() if x["source_id"] == clip_source and x.get("is_place_candidate")), None)
    if cand:
        break
    time.sleep(0.25)
if cand:
    r = c.post(f"/candidates/{cand['id']}/approve", json={})
    spot = next((x for x in c.get("/reels/spots").json() if x["place_id"] == (r.json().get("place_id") if r.status_code in (200, 201) else None)), None)
    if spot is None:
        spot = next((x for x in c.get("/reels/spots").json() if "cerro" in x["name"].lower()), None)
    if spot:
        r = c.get("/reels", params={"trip_place_id": spot["trip_place_id"]}); cl = r.json()
        rec("C3", r.status_code == 200 and cl and "start_seconds" in cl[0] and "found" in cl[0] and cl[0]["found"] is False, f"{len(cl)} clips; start={cl[0].get('start_seconds') if cl else None} found={cl[0].get('found') if cl else None}")
        rec("C1", spot["found_count"] == 0 and spot["clip_count"] >= 1, f"spot {spot['name']}: {spot['clip_count']} clips, {spot['found_count']} found")
    else:
        rec("C3", False, f"kept the candidate but no spot for it: {[x['name'] for x in c.get('/reels/spots').json()]}")
else:
    rec("C3", False, f"no place candidate extracted from the saved clip; inbox={[(x['title'], x['source_id'] == clip_source) for x in c.get('/inbox').json()][:5]}")
r = c.post("/sources", json={"url": "not a url"}); rec("V2", r.status_code in (400, 422), f"{r.status_code} {r.text[:80]}")
buf = io.BytesIO()
with zipfile.ZipFile(buf, "w") as z:
    z.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>')
    z.writestr("word/document.xml", '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Antigua 4 days, Acatenango overnight hike</w:t></w:r></w:p><w:p><w:r><w:t>סמוק צ׳מפיי בריכות טבעיות</w:t></w:r></w:p></w:body></w:document>')
r = c.post("/sources/upload", files={"files": ("plan.docx", buf.getvalue(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")})
rec("V3", r.status_code == 201 and r.json()[0]["status"] != "failed", f"{r.status_code} {json.dumps(r.json())[:120]}")
r = c.post("/sources/upload", files={"files": ("plan.html", b"<html><head><style>.x{}</style><script>alert(1)</script></head><body><h1>Lanquin</h1><p>Semuc Champey pools, 2 nights</p></body></html>", "text/html")})
rec("V5", r.status_code == 201, f"{r.status_code} {json.dumps(r.json())[:100]}")
if r.status_code == 201 and r.json()[0].get("file_url"):
    f = httpx.get("http://127.0.0.1:8001" + r.json()[0]["file_url"]) if r.json()[0]["file_url"].startswith("/") else httpx.get(r.json()[0]["file_url"])
    rec("V5b", "text/html" not in f.headers.get("content-type", "") and f.headers.get("x-content-type-options") == "nosniff", f"served as {f.headers.get('content-type')} nosniff={f.headers.get('x-content-type-options')}")
r = c.post("/sources/upload", files={"files": ("evil.exe", b"MZ\x90\x00", "application/x-msdownload")})
rec("V6", r.status_code in (400, 415, 422), f"{r.status_code} {r.text[:80]}")
r = c.post("/knowledge", json={"type": "general", "title": "Bring a headlamp", "body": "For the Acatenango hike", "destination_scope": "Antigua"}); rec("V7", r.status_code == 201, f"{r.status_code}")

# ---- 8. ask
def ask(q, **kw):
    r = c.post("/ask", json={"question": q, "surface": "home", **kw})
    a = r.json() if r.status_code == 200 else {}
    a["text"] = a.get("answer", "")
    return r, a
r, a = ask("Is Antigua safe at night?"); rec("Q1", r.status_code == 200 and a.get("citations"), f"{a.get('text','')[:80]!r} cites={len(a.get('citations',[]))}")
r, a = ask("Is Rio safe?"); rec("Q2", r.status_code == 200 and ("rio" in a.get("text","").lower()), f"{a.get('text','')[:80]!r}")
r, a = ask("What should I know about Bogotá?"); rec("Q3", r.status_code == 200, f"{a.get('text','')[:80]!r} tools={a.get('tools_used')}")
# A proposal comes from a practical question about one place: the place is
# the focus, and "worth going today" is what makes it practical.
focus = c.get("/places").json()[0]
before_items = len(c.get("/itinerary").json()) if c.get("/itinerary").status_code == 200 else None
r, a = ask(f"Is {focus['name']} worth going to today?", lat=14.5586, lon=-90.7295, trip_place_id=focus["trip_place_id"]); props = a.get("proposed_actions") or []
after_items = len(c.get("/itinerary").json()) if c.get("/itinerary").status_code == 200 else None
rec("Q4", r.status_code == 200 and len(props) == 1 and props[0]["type"] == "add_to_today" and before_items == after_items, f"{a.get('text','')[:60]!r} proposals={len(props)} items {before_items}->{after_items}")
if props:
    r = c.post("/ask/confirm", json=props[0]); rec("Q5", r.status_code == 200, f"{r.status_code} {r.text[:60]}")
    r2 = c.post("/ask/confirm", json=props[0]); rec("Q5b", r2.status_code == 200 and r2.json().get("itinerary_item_id") == r.json().get("itinerary_item_id"), "second confirm is the same item")
else:
    rec("Q5", False, "no proposal to confirm (check in UI with a place focus)")
r = c.post("/ask/confirm", json={"type": "delete_everything", "payload": {}}); rec("Q6/X", r.status_code == 400, f"{r.status_code}")
r, a = ask("Do I need a visa for Brazil?"); rec("Q7", r.status_code == 200 and any("official" in d.lower() or "verify" in d.lower() for d in a.get("disclaimers", [])) or any("official" in (x.get("body") or "").lower() for x in a.get("cards", [])), f"disc={a.get('disclaimers')}")
r = c.post("/ask", json={"question": ""}); rec("Q8", r.status_code == 422, f"{r.status_code}")
r, a = ask("האם אנטיגואה בטוחה?"); rec("Q9", r.status_code == 200 and a.get("text"), f"{a.get('text','')[:60]!r}")

# ---- 9. profile
r = c.put("/activities", json={"slugs": ["hike", "coffee"]}); rec("R1", r.status_code == 200 and sorted(r.json()["picked"]) == ["coffee", "hike"], f"{r.status_code} {r.text[:60]}")

# ---- timezone
r = httpx.get(f"{B}/home", headers={**H, "X-TripStash-Timezone": "Pacific/Kiritimati"}); d1 = r.json()["date"]
r = httpx.get(f"{B}/home", headers={**H, "X-TripStash-Timezone": "Pacific/Pago_Pago"}); d2 = r.json()["date"]
rec("TZ", d1 >= d2, f"Kiritimati={d1} PagoPago={d2}")

print(f"{'ID':<22} {'RESULT':<6} DETAIL")
for tid, ok, detail in R:
    print(f"{tid:<22} {'PASS' if ok else 'FAIL':<6} {detail}")
print(f"\n{sum(1 for _,ok,_ in R if ok)} pass, {sum(1 for _,ok,_ in R if not ok)} fail")
