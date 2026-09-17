"""Seed the demo trip: `python -m app.seed`.

The demo is the traveller's own plan — Central America and Brazil, twenty
stops from Mexico City to Florianópolis — written down by them, so every
row carries `user` provenance ("yours") and none of it needs review. Photos
are links to where they were found, attached to the stop's places.

The seed is versioned: when SEED_VERSION changes, an existing demo database
is rebuilt on the next boot, which is how a deployed copy picks up new data.
"""

from __future__ import annotations

import json
import sys
from datetime import date, timedelta

from sqlalchemy import select

from app.adapters.storage import text_fingerprint
from app.config import get_settings
from app.db import engine, init_db, session_scope
from app.models.base import Base
from app.models.capture import KnowledgeItem, Source, SourcePlaceEvidence
from app.models.core import Destination, Trip, User
from app.models.enums import (
    KnowledgeType,
    PlaceCategory,
    PlaceStatus,
    Provenance,
    SourceKind,
    SourceStatus,
)
from app.models.places import Place, TripPlace
from app.services.security import hash_password
from app.services.text import normalize_name

DEMO_EMAIL = "traveller@example.com"
DEMO_PASSWORD = "tripstash-demo-password"
SEED_VERSION = "2026-09-17-central-america-brazil"

TRIP_NAME = "Central America + Brazil"
TRIP_START = date(2026, 12, 5)  # Rio lands three days before Carnival
CARNIVAL = (date(2027, 2, 5), date(2027, 2, 10))

# fmt: off
# Each stop: latin name, Hebrew name, country, lat, lon, days (mean of the
# plan's range), the plan's description, hostels and photos, and the places
# the description names. Places are (name, category, lat, lon, why, status).
STOPS: list[dict] = [
    {
        "name": "Mexico City", "he": "מקסיקו סיטי", "country": "Mexico", "lat": 19.4326, "lon": -99.1332, "days": 4.5,
        "sub": "4–5 ימים • פתיחה עירונית וחברתית",
        "desc": "עיר ענקית אבל מאוד נוחה לפתיחת הטיול אם ישנים בהוסטל חברתי. מסתובבים במרכז ההיסטורי, בשכונות רומא וקונדסה שמלאות בתי קפה, מסעדות וברים, וטועמים אוכל רחוב. גולת הכותרת מחוץ לעיר היא טאוטיווקאן — מתחם עתיק עצום עם פירמידות ושדרה מרכזית; מקדישים לו בדרך כלל חצי יום עד יום.",
        "israeli": None,
        "hostel": ("Viajero CDMX Centro", 19.4330, -99.1400, "הוסטל חברתי, פעילויות משותפות וקהל צעיר."),
        "places": [
            ("Teotihuacán", PlaceCategory.ATTRACTION, 19.6925, -98.8438, "מתחם עתיק עצום עם פירמידות ושדרה מרכזית; חצי יום עד יום.", PlaceStatus.MUST_VISIT),
            ("Roma & Condesa", PlaceCategory.CAFE, 19.4150, -99.1700, "שכונות מלאות בתי קפה, מסעדות וברים.", PlaceStatus.SAVED),
        ],
        "photos": [
            "https://images.squarespace-cdn.com/content/v1/648298d458403e1344232773/1752783836032-5CPNAY20CTVIZYFKTV4B/INTRO.jpg",
            "https://i0.wp.com/advtravelbug.com/wp-content/uploads/2020/12/IMG_4683-copy.jpg?fit=1276%2C957&ssl=1",
            "https://lp-cms-production.imgix.net/2022-03/Mexico%20Oaxaca%20%C2%A9%20streetflash%20shutterstock_1314143660.jpg?auto=format&dpr=2&fit=crop&ixlib=react-8.6.4&q=45&w=1000",
        ],
    },
    {
        "name": "Oaxaca", "he": "אואחאקה", "country": "Mexico", "lat": 17.0732, "lon": -96.7266, "days": 3.5,
        "sub": "3–4 ימים • אוכל, תרבות ונוף",
        "desc": "עיר צבעונית ורגועה יותר ממקסיקו סיטי. מטיילים ברחובות ובשווקים, אוכלים אוכל מקומי ועושים טעימות מזקל. מחוץ לעיר נמצאת מונטה אלבאן — עיר עתיקה על פסגת הר — וגם Hierve el Agua, בריכות מינרליות טבעיות בקצה מצוק עם נוף להרים.",
        "israeli": None,
        "hostel": ("Casa Angel Hostel", 17.0640, -96.7250, "הוסטל חברתי עם פעילויות, סלסה, סיורים וערבי יציאה."),
        "places": [
            ("Monte Albán", PlaceCategory.ATTRACTION, 17.0436, -96.7674, "עיר עתיקה על פסגת הר.", PlaceStatus.SAVED),
            ("Hierve el Agua", PlaceCategory.NATURE, 16.8657, -96.2760, "בריכות מינרליות טבעיות בקצה מצוק עם נוף להרים.", PlaceStatus.MUST_VISIT),
        ],
        "photos": [
            "https://i0.wp.com/ribbitandco.com/wp-content/uploads/2023/04/oaxaca-guide-street-scene-mfrh-original-scaled.jpg?fit=1920%2C2560&ssl=1",
            "https://lp-cms-production.imgix.net/2022-03/Mexico%20Oaxaca%20%C2%A9%20streetflash%20shutterstock_1314143660.jpg?auto=format&dpr=2&fit=crop&ixlib=react-8.6.4&q=45&w=1000",
        ],
    },
    {
        "name": "Puerto Escondido", "he": "פוארטו אסקונדידו", "country": "Mexico", "lat": 15.8720, "lon": -97.0767, "days": 5,
        "sub": "4–6 ימים • גלישה, חופים ומסיבות",
        "desc": "עיירת גלישה על האוקיינוס השקט. לוקחים שיעור גלישה, מבלים בחופים ובאזור La Punta, ורוב הערבים יש ברים ומסיבות עם הרבה מטיילים צעירים. Zicatela מפורסמת בגלים חזקים מאוד, לכן למתחילים בוחרים אזור מתאים עם בית ספר לגלישה.",
        "israeli": None,
        "hostel": ("Bonita Escondida", 15.8600, -97.0500, "בריכה, אירועים, קהל צעיר ואווירה מאוד חברתית."),
        "places": [
            ("La Punta", PlaceCategory.NATURE, 15.8583, -97.0433, "אזור הגלישה למתחילים, ברים ומסיבות בערב.", PlaceStatus.SAVED),
            ("Playa Zicatela", PlaceCategory.NATURE, 15.8630, -97.0620, "מפורסמת בגלים חזקים מאוד — לא למתחילים.", PlaceStatus.SAVED),
        ],
        "safety": ("Zicatela: גלים חזקים מאוד", "Zicatela מפורסמת בגלים חזקים מאוד, לכן למתחילים בוחרים אזור מתאים עם בית ספר לגלישה."),
        "photos": [
            "https://www.mexicotravelandleisure.com/blog/surfing-in-mexico/la-punta-puerto-escondido-waves.jpg",
            "https://www.islands.com/img/gallery/puerto-escondido-boasts-an-effortlessly-cool-hotel-blending-surf-culture-with-boutique-style-in-mexico/world-class-surfing-and-stunning-natural-beauty-1747825437.jpg",
        ],
    },
    {
        "name": "Antigua", "he": "אנטיגואה + אקטננגו", "country": "Guatemala", "lat": 14.5586, "lon": -90.7295, "days": 4,
        "sub": "3–4 ימים בעיר + טרק לילה",
        "desc": "אנטיגואה היא עיר קולוניאלית יפה ומרכז תרמילאים גדול. החוויה המרכזית היא אקטננגו: עולים להר געש, ישנים במחנה בגובה, ובמזג אוויר מתאים רואים את הר הגעש פואגו ממול פולט עשן ולעיתים לבה. זה טרק אחד משמעותי בתוך הטיול — לא מסלול שבנוי כולו מטרקים.",
        "israeli": ("Zoola Antigua", 14.5570, -90.7330, "מזוהה היסטורית עם ישראלים; צריך לאמת סמוך לנסיעה שהוא עדיין פועל באותו אופי."),
        "hostel": ("Tropicana Hostel", 14.5590, -90.7350, "הוסטל מאוד חברתי שמוציא גם טרקי אקטננגו."),
        "places": [
            ("Acatenango Volcano", PlaceCategory.NATURE, 14.5008, -90.8761, "טרק לילה: ישנים במחנה בגובה ורואים את פואגו פולט עשן ולעיתים לבה.", PlaceStatus.MUST_VISIT),
        ],
        "photos": [
            "https://i0.wp.com/antiguadailyphoto.com/wp-content/uploads/2019/08/p3574394936-3-8208187-4926679.jpg?fit=580%2C387&ssl=1",
            "https://cdn.kimkim.com/files/a/images/4538cad3e23917934d5d4dac2519dd1820d83806/original-4ffff5cb789e3d2017835fa9738a4073.jpg",
        ],
    },
    {
        "name": "San Pedro La Laguna", "he": "סן פדרו / אגם אטיטלן", "country": "Guatemala", "lat": 14.6917, "lon": -91.2722, "days": 5,
        "sub": "4–6 ימים • אגם, קהילה ורוגע",
        "desc": "אגם עצום מוקף הרי געש וכפרים. ישנים בסן פדרו, עוברים בסירות בין הכפרים, עושים קיאק או סאפ, יושבים בבתי קפה ויוצאים בערב. זה יעד שבו אפשר בכוונה להאט לכמה ימים ולהמשיך לטייל עם אנשים שפגשת בדרך.",
        "israeli": ("Sababa Resort", 14.6930, -91.2740, "Sababa Resort / Casa Blanca — אזור עם נוכחות ישראלית חזקה."),
        "hostel": None,
        "places": [
            ("Lake Atitlán", PlaceCategory.NATURE, 14.6907, -91.2025, "סירות בין הכפרים, קיאק או סאפ.", PlaceStatus.SAVED),
        ],
        "notes": "לבחור הוסטל חברתי בסן פדרו לפי הקהל והביקורות בזמן ההגעה.",
        "photos": [
            "https://i.pinimg.com/originals/65/3f/d7/653fd720e0f3a0c175d78a3c01e74a5d.jpg",
            "https://cdn.kimkim.com/files/a/images/4538cad3e23917934d5d4dac2519dd1820d83806/original-4ffff5cb789e3d2017835fa9738a4073.jpg",
        ],
    },
    {
        "name": "Lanquín", "he": "סמוק שמפיי", "country": "Guatemala", "lat": 15.5750, "lon": -89.9800, "days": 2.5,
        "sub": "2–3 ימים • ג'ונגל ובריכות טבעיות",
        "desc": "מערכת של בריכות טבעיות בצבע טורקיז בתוך ג'ונגל צפוף. שוחים בין הבריכות, עולים לתצפית שרואים ממנה את כל המתחם, ואפשר להוסיף סיור מערות ונהר. הנסיעה לשם ארוכה יחסית ולכן כדאי להגיע לפחות לשני לילות.",
        "israeli": None,
        "hostel": None,
        "places": [
            ("Semuc Champey", PlaceCategory.NATURE, 15.5330, -89.9600, "בריכות טורקיז בג'ונגל; לעלות לתצפית ולהוסיף סיור מערות ונהר. לפחות שני לילות.", PlaceStatus.MUST_VISIT),
        ],
        "notes": "לבחור הוסטל חברתי באזור Lanquín. הנסיעה לשם ארוכה יחסית — לפחות שני לילות.",
        "photos": [
            "https://www.abc.com.py/resizer/v2/LWE67HZGW5FBJHQ7VSD4XI6BOQ.jpg?auth=636ea322e800142f399a54687ec1819d4387d9dc64f4b26d1f28768e5059a5f3",
            "https://static.wixstatic.com/media/b9ed91_37e66086926f4164ace78899f1ce2397~mv2.jpg/v1/fill/w_488,h_488,al_c,q_80/b9ed91_37e66086926f4164ace78899f1ce2397~mv2.jpg",
        ],
    },
    {
        "name": "León", "he": "לאון", "country": "Nicaragua", "lat": 12.4345, "lon": -86.8780, "days": 3.5,
        "sub": "3–4 ימים • Volcano Boarding",
        "desc": "הפעילות המפורסמת היא Volcano Boarding: נוסעים להר הגעש Cerro Negro, עולים ברגל עם הציוד ואז יורדים על קרש במדרון של אפר וולקני שחור. לאון עצמה צעירה, קולוניאלית ויש בה ברים והוסטלים חברתיים.",
        "israeli": None,
        "hostel": ("Bigfoot Hostel", 12.4350, -86.8790, "אחד הבסיסים המוכרים ל־Volcano Boarding ולחיי חברה."),
        "places": [
            ("Cerro Negro", PlaceCategory.ACTIVITY, 12.5060, -86.7020, "Volcano Boarding: עולים ברגל עם הציוד ויורדים על קרש במדרון של אפר שחור.", PlaceStatus.MUST_VISIT),
        ],
        "photos": [
            "https://www.visitleon.info/uploads/1/2/0/4/120453990/volcano-boarding-top-10-visit-leon-nicaragua_2_orig.jpg",
            "https://img.diepresse.com/public/incoming/x0w4zp-Nicaragua_Granada_Alamy.jpg/alternates/WEBP_FREE_1200/Nicaragua_Granada_Alamy.jpg",
        ],
    },
    {
        "name": "Granada", "he": "גרנדה", "country": "Nicaragua", "lat": 11.9344, "lon": -85.9560, "days": 2.5,
        "sub": "2–3 ימים • עיר קולוניאלית ואגם",
        "desc": "עיר צבעונית על שפת אגם ניקרגואה. מטיילים ברחובות, עולים לתצפיות מהכנסיות ויוצאים לשיט בין האיים הקטנים שנוצרו ליד החוף. זו תחנה טובה להוריד קצת קצב בין לאון לאומטפה.",
        "israeli": None,
        "hostel": None,
        "places": [
            ("Las Isletas", PlaceCategory.ACTIVITY, 11.9100, -85.9100, "שיט בין האיים הקטנים ליד החוף.", PlaceStatus.SAVED),
        ],
        "notes": "לבחור הוסטל מרכזי וחברתי לפי הביקורות בזמן ההגעה.",
        "photos": [
            "https://img.diepresse.com/public/incoming/x0w4zp-Nicaragua_Granada_Alamy.jpg/alternates/WEBP_FREE_1200/Nicaragua_Granada_Alamy.jpg",
            "https://www.worldplacesexplained.com/images/granada-colonial-city.jpg",
        ],
    },
    {
        "name": "Ometepe", "he": "אומטפה", "country": "Nicaragua", "lat": 11.5400, "lon": -85.6960, "days": 3.5,
        "sub": "3–4 ימים • אי עם שני הרי געש",
        "desc": "אי בלב אגם ניקרגואה שנוצר משני הרי געש. שוכרים קטנוע ומסתובבים בין כפרים, חופים ותצפיות. Ojo de Agua היא בריכת מעיין טבעית בתוך צמחייה טרופית. אפשר לעשות טרק להר געש, אבל הוא לא חובה אצלך כי כבר יש את אקטננגו.",
        "israeli": None,
        "hostel": None,
        "places": [
            ("Ojo de Agua", PlaceCategory.NATURE, 11.5600, -85.5600, "בריכת מעיין טבעית בתוך צמחייה טרופית.", PlaceStatus.SAVED),
        ],
        "notes": "לבחור הוסטל עם בר ואזור משותף חזק — כאן הלינה משפיעה מאוד על הצד החברתי.",
        "photos": [
            "https://pub-c31324d8bd4c46158423104c62276bcf.r2.dev/tratoli/destinations/518.jpg",
            "https://www.visitanicaragua.com/wp-content/uploads/2021/10/Ojo-de-Agua-Isla-de-Ometepe.jpg",
        ],
    },
    {
        "name": "San Juan del Sur", "he": "סן חואן דל סור", "country": "Nicaragua", "lat": 11.2529, "lon": -85.8705, "days": 5,
        "sub": "4–6 ימים • גלישה וחיי לילה",
        "desc": "עיירת חוף שמוקפת בחופי גלישה. ביום נוסעים לחופים כמו Maderas ו־Remanso, ובערב חוזרים לעיירה לברים ומסיבות. Sunday Funday הוא אירוע מסיבות בריכה גדול שמושך הרבה Backpackers.",
        "israeli": None,
        "hostel": ("Hola Ola Hostel", 11.2530, -85.8700, "מתאים מאוד למטיילי סולו ולמי שרוצה להכיר אנשים."),
        "places": [
            ("Playa Maderas", PlaceCategory.NATURE, 11.2960, -85.8990, "חוף גלישה ליום.", PlaceStatus.SAVED),
            ("Playa Remanso", PlaceCategory.NATURE, 11.2380, -85.8720, "חוף גלישה ליום.", PlaceStatus.SAVED),
        ],
        "general": ("Sunday Funday", "אירוע מסיבות בריכה גדול בכל יום ראשון שמושך הרבה Backpackers."),
        "photos": [
            "https://cdn.windyapp.co/reports/2024-04-15/image_3725C359-EB37-457A-8550-D93A58587DD5_img661d9582a9842.jpg",
            "https://www.lifeinnica.com/wp-content/uploads/2022/02/san-juan-del-sur-beach.jpg",
        ],
    },
    {
        "name": "La Fortuna", "he": "לה פורטונה", "country": "Costa Rica", "lat": 10.4678, "lon": -84.6427, "days": 3.5,
        "sub": "3–4 ימים • הר געש, מפלים ואקסטרים",
        "desc": "אזור הר הגעש ארנל. עושים מסלולים קצרים בטבע, מבקרים במפל La Fortuna, נכנסים למעיינות חמים ואפשר להוסיף רפטינג, קניונינג ואומגות. זה פרק אקסטרים וטבע בלי צורך בטרקים ארוכים.",
        "israeli": None,
        "hostel": ("Viajero La Fortuna", 10.4690, -84.6450, "הוסטל חברתי עם פעילויות וקהל בינלאומי."),
        "places": [
            ("La Fortuna Waterfall", PlaceCategory.NATURE, 10.4440, -84.6690, "מפל; מסלולים קצרים בטבע.", PlaceStatus.SAVED),
            ("Arenal hot springs", PlaceCategory.ACTIVITY, 10.4870, -84.6980, "מעיינות חמים לרגלי הר הגעש ארנל.", PlaceStatus.SAVED),
        ],
        "photos": [
            "https://www.visitcostarica.com/sites/default/files/styles/scale_1920/public/2024-09/couple-bathing-volcano-kioro-hot-springs-la-fortuna_EDIT.jpg?itok=h4NTqCFs",
            "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6d/Arenal_Volcano_as_seen_from_Monteverde.jpg/1280px-Arenal_Volcano_as_seen_from_Monteverde.jpg",
        ],
    },
    {
        "name": "Monteverde", "he": "מונטוורדה", "country": "Costa Rica", "lat": 10.3100, "lon": -84.8250, "days": 2.5,
        "sub": "2–3 ימים • יער עננים",
        "desc": "יער הררי גבוה ולח שבו יש הרבה ערפל, טחב וצמחייה צפופה. עושים גשרים תלויים מעל היער, אומגות ארוכות וסיורי לילה שבהם מחפשים חיות. המקום קריר ורטוב יותר מהחופים.",
        "israeli": None,
        "hostel": ("OutBox Inn", 10.3130, -84.8230, "בחירה חברתית טובה באזור."),
        "places": [
            ("Monteverde Cloud Forest Reserve", PlaceCategory.NATURE, 10.3020, -84.7900, "יער עננים: ערפל, טחב וצמחייה צפופה; סיורי לילה לחיות.", PlaceStatus.MUST_VISIT),
            ("Monteverde hanging bridges", PlaceCategory.ACTIVITY, 10.3200, -84.8100, "גשרים תלויים מעל היער ואומגות ארוכות.", PlaceStatus.SAVED),
        ],
        "packing": ("מונטוורדה: קריר ורטוב", "המקום קריר ורטוב יותר מהחופים — שכבה חמה ומעיל גשם."),
        "photos": [
            "https://www.bautrip.com/images/what-to-visit/monteverde-natural-reserve-costa-rica.jpg",
            "https://d19lgisewk9l6l.cloudfront.net/wexas/www/images/largeimages/destinations/Costa-Rica/monteverde-zip.jpg",
            "https://res.cloudinary.com/vacationscostarica-com/image/upload/v1661293129/monteverde_howler_monkey_wildlife_365bc109a6.jpg",
        ],
    },
    {
        "name": "Jacó", "he": "חאקו", "country": "Costa Rica", "lat": 9.6146, "lon": -84.6285, "days": 4,
        "sub": "3–5 ימים • גלישה + תחנה ישראלית",
        "desc": "עיירת חוף עם גלישה וחיי לילה, ובנוסף אחת התחנות שבהן יש קהילה ישראלית מורגשת. אפשר לעשות שיעורי גלישה, לצאת בערב, ולהשתמש במקום כעצירה חברתית. את פרק הצלילה של 3–5 ימים אפשר למקם בחלק אחר של קוסטה ריקה אם נבחר אתר צלילה מתאים יותר.",
        "israeli": ("Izu's Place", 9.6100, -84.6300, "Izu's Place / בית פתוח — מקומות שמזוהים עם קהל ישראלי, שבתות ואוכל ישראלי/יהודי."),
        "hostel": None,
        "places": [
            ("Jacó Beach", PlaceCategory.NATURE, 9.6120, -84.6320, "שיעורי גלישה ביום, יציאה בערב.", PlaceStatus.SAVED),
        ],
        "notes": "לבחור Surf Hostel בינלאומי לפי ביקורות עדכניות.",
        "photos": [
            "https://copadearbol.com/wp-content/uploads/2023/12/Surfing-jaco-beach-costa-rica.jpg",
            "https://i.pinimg.com/originals/d9/82/15/d98215b1f9e049512acb15b1a6f7a0cd.jpg",
        ],
    },
    {
        "name": "Playa Venao", "he": "פלאיה ונאו", "country": "Panama", "lat": 7.4250, "lon": -80.1900, "days": 6,
        "sub": "5–7 ימים • גלישה, חוף וקהילה",
        "desc": "מפרץ קטן שמרכז סביבו גלישה, יוגה, הוסטלים, מסיבות וקהילה של מטיילים. בגלל שהכול קרוב, קל להכיר אנשים ולהישאר כאן שבוע. יש גם נוכחות ישראלית חזקה יחסית.",
        "israeli": ("El Sitio", 7.4290, -80.1880, "מקום בבעלות ישראלית באזור עם קהילה ישראלית פעילה."),
        "hostel": ("Eco Venao", 7.4310, -80.1950, "Eco Venao / Tipi Hostel — אופציות בינלאומיות עם אווירת חוף וגלישה."),
        "places": [],
        "photos": [
            "https://res.cloudinary.com/simpleview/image/upload/v1759888585/clients/panama/large_Surf_at_Playa_Venao_Azuero_Los_Santos_Province_Panam__47f2e345-db3b-4b0e-8146-8471be0320d3.jpg",
            "https://2.bp.blogspot.com/-s8sF0mioDiw/VdqDPH3I2JI/AAAAAAAAADE/oj7uGSN8JC0/s1600/playa%2Bvenado%2B2.jpg",
            "https://images.myguide-cdn.com/content/2/large/playa-venao-an-oceanside-retreat-for-electronic-music-lovers-517498.jpeg",
        ],
    },
    {
        "name": "Panama City", "he": "פנמה סיטי", "country": "Panama", "lat": 8.9824, "lon": -79.5199, "days": 2.5,
        "sub": "2–3 ימים • עיר ותעלת פנמה",
        "desc": "ב־Casco Viejo מסתובבים בין רחובות קולוניאליים, מסעדות וברים על גגות. בתעלת פנמה רואים ספינות ענק עוברות דרך מערכת תאי מים שמעלה ומורידה אותן בין מפלסים. יומיים–שלושה מספיקים לרוב המטיילים.",
        "israeli": ("Loco Coco Loco", 8.9530, -79.5350, "מקום שמזוהה עם ישראלים ודוברי עברית."),
        "hostel": None,
        "places": [
            ("Casco Viejo", PlaceCategory.ATTRACTION, 8.9520, -79.5340, "רחובות קולוניאליים, מסעדות וברים על גגות.", PlaceStatus.SAVED),
            ("Miraflores Locks", PlaceCategory.ATTRACTION, 8.9960, -79.5910, "תעלת פנמה: ספינות ענק עוברות בתאי המים.", PlaceStatus.SAVED),
        ],
        "notes": "לבחור הוסטל חברתי באזור Casco Viejo.",
        "photos": [
            "https://res.cloudinary.com/simpleview/image/upload/v1615458773/clients/panama/PA_csco_34_f8e2520f-d65f-4372-a99b-14053c8cabdf.jpg",
            "https://i0.wp.com/theroyaltourblog.com/wp-content/uploads/2019/12/4f8970d9-2812-43ab-802a-b3ba2c903e3d.jpg?resize=720%2C960&ssl=1",
            "https://maritimemag.com/wp-content/uploads/2025/02/panama-locksA.jpg",
        ],
    },
    {
        "name": "San Blas", "he": "סן בלאס", "country": "Panama", "lat": 9.5600, "lon": -78.9500, "days": 2.5,
        "sub": "2–3 ימים • איים ושנורקלינג",
        "desc": "ארכיפלג קריבי של איים קטנים עם חול לבן ומים צלולים. ישנים בדרך כלל בבקתות פשוטות או באירוח שמפעילות קהילות Guna, עושים שיט בין איים ושנורקלינג. זה פחות יעד של מסיבות ויותר “להיעלם ליומיים מהעולם”.",
        "israeli": None,
        "hostel": None,
        "places": [
            ("San Blas Islands", PlaceCategory.NATURE, 9.5700, -78.9200, "איים קטנים, חול לבן, שיט ושנורקלינג; לינה בבקתות של קהילות Guna.", PlaceStatus.MUST_VISIT),
        ],
        "notes": "לא הוסטל ישראלי קלאסי — הלינה היא בדרך כלל מקומית. מזמינים חבילת לינה/שיט של לילה עד שלושה.",
        "photos": [
            "https://megustavolar.iberia.com/wp-content/uploads/ltf/2020/05/L2F-Apr-20-pic-Panama-San-Blas-Islands-woman-tourist-with-snorkel-mask-iStock-672436570.jpg",
            "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9f/San_Blas_Islands_Panama.jpg/1280px-San_Blas_Islands_Panama.jpg",
        ],
    },
    {
        "name": "Rio de Janeiro", "he": "ריו דה ז'ניירו", "country": "Brazil", "lat": -22.9068, "lon": -43.1729, "days": 8.5,
        "sub": "7–10 ימים סביב הקרנבל",
        "desc": "העוגן הגדול של סוף הטיול. מגיעים כמה ימים לפני הקרנבל כדי להכיר את העיר ואת האנשים בהוסטל. ביום עושים את חופי Ipanema ו־Copacabana, פסל ישו והר הסוכר; בלילה יוצאים ל־Lapa ולאירועי הרחוב. בזמן הקרנבל יש מסיבות רחוב עצומות ומצעדי סמבה — צריך להזמין לינה הרבה מראש.",
        "israeli": None,
        "hostel": ("More Ipanema Hostel", -22.9860, -43.2000, "מיקום טוב לחוף וקהל צעיר וחברתי."),
        "places": [
            ("Ipanema Beach", PlaceCategory.NATURE, -22.9868, -43.2050, "החוף ליום.", PlaceStatus.SAVED),
            ("Copacabana", PlaceCategory.NATURE, -22.9710, -43.1820, "החוף ליום; קהילה יהודית/ישראלית וחב\"ד באזור.", PlaceStatus.SAVED),
            ("Christ the Redeemer", PlaceCategory.ATTRACTION, -22.9519, -43.2105, "פסל ישו.", PlaceStatus.SAVED),
            ("Sugarloaf Mountain", PlaceCategory.VIEWPOINT, -22.9492, -43.1545, "הר הסוכר.", PlaceStatus.SAVED),
            ("Lapa", PlaceCategory.BAR, -22.9130, -43.1800, "בלילה יוצאים ל־Lapa ולאירועי הרחוב.", PlaceStatus.SAVED),
        ],
        "photos": [
            "https://citybasic.com/_next/image?q=75&url=%2Fimages%2Frio%2Fipanema-beach.jpg&w=3840",
            "https://upload.wikimedia.org/wikipedia/commons/thumb/9/98/Copacabana_Beach_Rio_de_Janeiro.jpg/1280px-Copacabana_Beach_Rio_de_Janeiro.jpg",
            "https://i0.wp.com/wonderlandinrave.com/wp-content/uploads/2021/12/imagem47841_1.jpg?fit=1350%2C900&ssl=1",
        ],
    },
    {
        "name": "Ilha Grande", "he": "איליה גרנדה", "country": "Brazil", "lat": -23.1400, "lon": -44.1700, "days": 6,
        "sub": "5–7 ימים • אי טרופי אחרי ריו",
        "desc": "אי ירוק עם ג'ונגל וחופים, כמעט ללא מכוניות. עושים שיט בין מפרצים, מגיעים לחוף Lopes Mendes, עושים שנורקלינג או צלילה והליכות קצרות. זה מעבר מצוין מהכאוס של ריו לקצב הרבה יותר רגוע.",
        "israeli": None,
        "hostel": ("Che Lagarto Ilha Grande", -23.1400, -44.1690, "Che Lagarto למסיבות / Balaio לאיזון רגוע יותר."),
        "places": [
            ("Lopes Mendes", PlaceCategory.NATURE, -23.1650, -44.1200, "החוף המפורסם של האי; שנורקלינג, צלילה והליכות קצרות.", PlaceStatus.MUST_VISIT),
        ],
        "photos": [
            "https://www.ilhagrandehiking.com/uploads/1/3/9/2/139280170/lopes-mendes.jpg",
            "https://s0.wklcdn.com/image_60/1802260/47020215/31014159.700x525.jpg",
        ],
    },
    {
        "name": "Paraty", "he": "פאראטי", "country": "Brazil", "lat": -23.2178, "lon": -44.7131, "days": 2.5,
        "sub": "2–3 ימים • עיר עתיקה ושיט",
        "desc": "עיירה קולוניאלית קטנה בין ריו לסאו פאולו. המרכז ההיסטורי בנוי מרחובות אבן ובתים לבנים וצבעוניים. ביום אפשר לצאת בסירת מפרש/סקונר בין איים ומפרצים, ובאזור יש גם מפלים ומזקקות קאשאסה.",
        "israeli": None,
        "hostel": ("Casa Viva Paraty", -23.2200, -44.7150, "אופציה חברתית טובה."),
        "places": [
            ("Paraty historic centre", PlaceCategory.ATTRACTION, -23.2200, -44.7130, "רחובות אבן ובתים לבנים וצבעוניים; שיט סקונר בין איים ומפרצים.", PlaceStatus.SAVED),
        ],
        "photos": [
            "https://media.mdzol.com/p/aab1cf2cbd3782552f61f51b1f865425/adjuntos/373/imagenes/001/833/0001833895/760x0/smart/shutterstock_2531274575.jpg",
            "https://q-xx.bstatic.com/xdata/images/xphoto/max1200/639745980.jpg?k=7b5eb220fdc019ca8619ce8b414ebdc18439ccf0137bba242bbdc3bc8c83d1bb&o=",
        ],
    },
    {
        "name": "Florianópolis", "he": "פלוריאנופוליס", "country": "Brazil", "lat": -27.5954, "lon": -48.5480, "days": 7.5,
        "sub": "6–9 ימים • גלישה וחופים לסיום",
        "desc": "אי גדול בדרום ברזיל עם הרבה חופים, אזורי גלישה וחיי לילה. אפשר לגלוש בחופים כמו Joaquina, לבלות באזור Lagoa da Conceição ולצאת למסיבות. מתאים במיוחד לסיים בו את ברזיל בלי למהר לעוד מדינה אחרי הקרנבל.",
        "israeli": None,
        "hostel": ("The Search House", -27.6280, -48.4550, "שילוב של חוף, גלישה וקהל בינלאומי צעיר."),
        "places": [
            ("Praia da Joaquina", PlaceCategory.NATURE, -27.6290, -48.4470, "חוף גלישה.", PlaceStatus.SAVED),
            ("Lagoa da Conceição", PlaceCategory.ATTRACTION, -27.6050, -48.4680, "לבלות ולצאת למסיבות.", PlaceStatus.SAVED),
        ],
        "photos": [
            "https://www.farejaviagens.com.br/wp-content/uploads/2025/04/Praia-da-Joaquina-Pinterest.jpg",
            "https://i0.wp.com/wonderlandinrave.com/wp-content/uploads/2021/12/imagem47841_1.jpg?fit=1350%2C900&ssl=1",
        ],
    },
]
# fmt: on


def _marker_path():
    settings = get_settings()
    settings.storage_dir.mkdir(parents=True, exist_ok=True)
    return settings.storage_dir / "seed.version"


def seed(force: bool = False) -> None:
    init_db()
    marker = _marker_path()
    current = marker.read_text().strip() if marker.exists() else ""
    with session_scope() as session:
        exists = session.execute(select(User).where(User.email == DEMO_EMAIL)).scalar_one_or_none()
    if exists and current == SEED_VERSION and not force:
        print(f"Demo account {DEMO_EMAIL} already seeded ({SEED_VERSION}) - nothing to do.")
        return
    if exists:
        # The demo data changed: this is a demo database, so it is rebuilt.
        print(f"Demo data is {current or 'unversioned'}; rebuilding as {SEED_VERSION}.")
        Base.metadata.drop_all(bind=engine)
        init_db()

    with session_scope() as session:
        user = User(
            email=DEMO_EMAIL,
            password_hash=hash_password(DEMO_PASSWORD),
            display_name="Demo traveller",
            base_currency="USD",
        )
        session.add(user)
        session.flush()

        total_days = sum(stop["days"] for stop in STOPS)
        trip = Trip(
            user_id=user.id,
            name=TRIP_NAME,
            start_date=TRIP_START,
            end_date=TRIP_START + timedelta(days=round(total_days)),
            base_currency="USD",
            total_budget=None,
            interests="surf,hostels,volcanoes,carnival",
        )
        session.add(trip)
        session.flush()

        # The plan itself is one source per stop: the traveller's own words.
        places_seeded = 0
        knowledge_seeded = 0
        photo_sources: dict[str, Source] = {}
        cursor = TRIP_START
        for position, stop in enumerate(STOPS):
            arrive = cursor
            depart = cursor + timedelta(days=round(stop["days"]))
            cursor = depart
            destination = Destination(
                trip_id=trip.id,
                name=stop["name"],
                country=stop["country"],
                lat=stop["lat"],
                lon=stop["lon"],
                position=position,
                arrive_on=arrive,
                depart_on=depart,
                is_current=False,
                notes=stop["sub"],
            )
            session.add(destination)
            session.flush()

            plan_text = f"{stop['he']} — {stop['sub']}\n\n{stop['desc']}"
            plan = Source(
                trip_id=trip.id,
                kind=SourceKind.ARTICLE,
                status=SourceStatus.COMPLETED,
                title=f"{stop['he']} — מסלול מרכז אמריקה + ברזיל",
                raw_text=plan_text,
                provenance=Provenance.USER,
                fingerprint=text_fingerprint("plan", stop["name"], stop["desc"]),
            )
            session.add(plan)
            session.flush()

            photos: list[Source] = []
            for index, url in enumerate(stop["photos"], start=1):
                # The plan reuses a few photos between stops: one source per picture.
                photo = photo_sources.get(url)
                if photo is None:
                    photo = Source(
                        trip_id=trip.id,
                        kind=SourceKind.LINK,
                        status=SourceStatus.COMPLETED,
                        url=url,
                        title=f"{stop['he']} — תמונה {index}",
                        media_type="image/jpeg",
                        provenance=Provenance.CREATOR,
                        fingerprint=text_fingerprint("photo", url),
                    )
                    session.add(photo)
                    photo_sources[url] = photo
                photos.append(photo)
            session.flush()

            # Places: the hostels named, then what the description names.
            specs: list[tuple[str, PlaceCategory, float, float, str, PlaceStatus]] = []
            if stop.get("israeli"):
                name, lat, lon, why = stop["israeli"]
                specs.append((name, PlaceCategory.ACCOMMODATION, lat, lon, f"🇮🇱 {why}", PlaceStatus.SAVED))
            if stop.get("hostel"):
                name, lat, lon, why = stop["hostel"]
                specs.append((name, PlaceCategory.ACCOMMODATION, lat, lon, f"🌍 {why}", PlaceStatus.SAVED))
            specs.extend(stop["places"])

            for name, category, lat, lon, why, status in specs:
                place = Place(
                    name=name,
                    normalized_name=normalize_name(name),
                    category=category,
                    lat=lat,
                    lon=lon,
                    city=stop["name"],
                    country=stop["country"],
                    provider="plan",
                )
                session.add(place)
                session.flush()
                session.add(
                    TripPlace(
                        trip_id=trip.id,
                        place_id=place.id,
                        destination_id=destination.id,
                        status=status,
                        reason_saved=why,
                        is_favourite=status == PlaceStatus.MUST_VISIT,
                        needs_review=False,
                    )
                )
                session.add(
                    SourcePlaceEvidence(
                        source_id=plan.id,
                        place_id=place.id,
                        trip_id=trip.id,
                        takeaway=why,
                        quote=why,
                        confidence=1.0,
                    )
                )
                for photo in photos:
                    session.add(
                        SourcePlaceEvidence(
                            source_id=photo.id,
                            place_id=place.id,
                            trip_id=trip.id,
                            takeaway=None,
                            quote=None,
                            confidence=1.0,
                        )
                    )
                places_seeded += 1

            # Knowledge: the stop's description as its note, plus what it flags.
            notes: list[tuple[KnowledgeType, str, str | None]] = [
                (KnowledgeType.GENERAL, f"{stop['he']}: {stop['sub']}", stop["desc"]),
            ]
            if stop.get("notes"):
                notes.append((KnowledgeType.ACCOMMODATION, f"{stop['he']}: לינה", stop["notes"]))
            if stop.get("safety"):
                notes.append((KnowledgeType.SAFETY, *stop["safety"]))
            if stop.get("packing"):
                notes.append((KnowledgeType.PACKING, *stop["packing"]))
            if stop.get("general"):
                notes.append((KnowledgeType.GENERAL, *stop["general"]))
            for kind, title, body in notes:
                session.add(
                    KnowledgeItem(
                        trip_id=trip.id,
                        source_id=plan.id,
                        destination_id=destination.id,
                        type=kind,
                        title=title[:240],
                        body=body,
                        destination_scope=stop["name"],
                        confidence=1.0,
                        provenance=Provenance.USER,
                        evidence_json=json.dumps(
                            [{"quote": (body or title)[:400], "channel": "text"}], ensure_ascii=False
                        ),
                    )
                )
                knowledge_seeded += 1

        # The one dated thing on the plan: Carnival in Rio.
        rio = next(d for d in trip.destinations if d.name == "Rio de Janeiro")
        session.add(
            KnowledgeItem(
                trip_id=trip.id,
                destination_id=rio.id,
                type=KnowledgeType.EVENT,
                title="קרנבל ריו דה ז'ניירו",
                body=(
                    "מסיבות רחוב עצומות ומצעדי סמבה. מגיעים כמה ימים לפני כדי להכיר את העיר "
                    "ואת האנשים בהוסטל — וצריך להזמין לינה הרבה מראש. לאמת את התאריכים המדויקים."
                ),
                destination_scope="Rio de Janeiro",
                confidence=0.9,
                provenance=Provenance.USER,
                evidence_json="[]",
                happens_on=CARNIVAL[0],
                ends_on=CARNIVAL[1],
            )
        )
        knowledge_seeded += 1

        marker.write_text(SEED_VERSION)
        print(
            f"Seeded {DEMO_EMAIL} / {DEMO_PASSWORD}\n"
            f"  trip: {trip.name} ({trip.start_date} → {trip.end_date}, {len(STOPS)} stops)\n"
            f"  places: {places_seeded}\n"
            f"  notes and events: {knowledge_seeded}"
        )


if __name__ == "__main__":
    sys.exit(seed(force="--force" in sys.argv))
