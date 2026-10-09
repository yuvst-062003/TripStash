"""Country names, for reading a country out of a travel guide.

A stop added by name has to end up in a country, because the country is how
the map outlines it, how the trip check counts it and how Explore files it.
Wikivoyage can say where a place is in three ways, in descending order of
confidence: the ISO code on its coordinates (`coprop=country`, set on only a
few articles), the country in its title ("Flores (Guatemala)"), and the
country its first sentence names ("Flores is a town in Petén, Guatemala").
The last two need a list of what counts as a country, which is this file.

Names are the English short forms the app's map data (Natural Earth, via
world-atlas) uses, so a country read here is the country the map outlines.
"""

from __future__ import annotations

import re
import unicodedata

#: ISO 3166-1 alpha-2 code to the English short name.
ISO_TO_NAME: dict[str, str] = {
    "AD": "Andorra", "AE": "United Arab Emirates", "AF": "Afghanistan",
    "AG": "Antigua and Barbuda", "AI": "Anguilla", "AL": "Albania", "AM": "Armenia",
    "AO": "Angola", "AQ": "Antarctica", "AR": "Argentina", "AS": "American Samoa",
    "AT": "Austria", "AU": "Australia", "AW": "Aruba", "AX": "Åland Islands",
    "AZ": "Azerbaijan", "BA": "Bosnia and Herzegovina", "BB": "Barbados",
    "BD": "Bangladesh", "BE": "Belgium", "BF": "Burkina Faso", "BG": "Bulgaria",
    "BH": "Bahrain", "BI": "Burundi", "BJ": "Benin", "BL": "Saint Barthélemy",
    "BM": "Bermuda", "BN": "Brunei", "BO": "Bolivia", "BQ": "Bonaire", "BR": "Brazil",
    "BS": "Bahamas", "BT": "Bhutan", "BV": "Bouvet Island", "BW": "Botswana",
    "BY": "Belarus", "BZ": "Belize", "CA": "Canada", "CC": "Cocos Islands",
    "CD": "Democratic Republic of the Congo", "CF": "Central African Republic",
    "CG": "Republic of the Congo", "CH": "Switzerland", "CI": "Ivory Coast",
    "CK": "Cook Islands", "CL": "Chile", "CM": "Cameroon", "CN": "China",
    "CO": "Colombia", "CR": "Costa Rica", "CU": "Cuba", "CV": "Cape Verde",
    "CW": "Curaçao", "CX": "Christmas Island", "CY": "Cyprus", "CZ": "Czech Republic",
    "DE": "Germany", "DJ": "Djibouti", "DK": "Denmark", "DM": "Dominica",
    "DO": "Dominican Republic", "DZ": "Algeria", "EC": "Ecuador", "EE": "Estonia",
    "EG": "Egypt", "EH": "Western Sahara", "ER": "Eritrea", "ES": "Spain",
    "ET": "Ethiopia", "FI": "Finland", "FJ": "Fiji", "FK": "Falkland Islands",
    "FM": "Micronesia", "FO": "Faroe Islands", "FR": "France", "GA": "Gabon",
    "GB": "United Kingdom", "GD": "Grenada", "GE": "Georgia", "GF": "French Guiana",
    "GG": "Guernsey", "GH": "Ghana", "GI": "Gibraltar", "GL": "Greenland",
    "GM": "Gambia", "GN": "Guinea", "GP": "Guadeloupe", "GQ": "Equatorial Guinea",
    "GR": "Greece", "GS": "South Georgia and the South Sandwich Islands",
    "GT": "Guatemala", "GU": "Guam", "GW": "Guinea-Bissau", "GY": "Guyana",
    "HK": "Hong Kong", "HM": "Heard Island and McDonald Islands", "HN": "Honduras",
    "HR": "Croatia", "HT": "Haiti", "HU": "Hungary", "ID": "Indonesia",
    "IE": "Ireland", "IL": "Israel", "IM": "Isle of Man", "IN": "India",
    "IO": "British Indian Ocean Territory", "IQ": "Iraq", "IR": "Iran",
    "IS": "Iceland", "IT": "Italy", "JE": "Jersey", "JM": "Jamaica", "JO": "Jordan",
    "JP": "Japan", "KE": "Kenya", "KG": "Kyrgyzstan", "KH": "Cambodia",
    "KI": "Kiribati", "KM": "Comoros", "KN": "Saint Kitts and Nevis",
    "KP": "North Korea", "KR": "South Korea", "KW": "Kuwait", "KY": "Cayman Islands",
    "KZ": "Kazakhstan", "LA": "Laos", "LB": "Lebanon", "LC": "Saint Lucia",
    "LI": "Liechtenstein", "LK": "Sri Lanka", "LR": "Liberia", "LS": "Lesotho",
    "LT": "Lithuania", "LU": "Luxembourg", "LV": "Latvia", "LY": "Libya",
    "MA": "Morocco", "MC": "Monaco", "MD": "Moldova", "ME": "Montenegro",
    "MF": "Saint Martin", "MG": "Madagascar", "MH": "Marshall Islands",
    "MK": "North Macedonia", "ML": "Mali", "MM": "Myanmar", "MN": "Mongolia",
    "MO": "Macau", "MP": "Northern Mariana Islands", "MQ": "Martinique",
    "MR": "Mauritania", "MS": "Montserrat", "MT": "Malta", "MU": "Mauritius",
    "MV": "Maldives", "MW": "Malawi", "MX": "Mexico", "MY": "Malaysia",
    "MZ": "Mozambique", "NA": "Namibia", "NC": "New Caledonia", "NE": "Niger",
    "NF": "Norfolk Island", "NG": "Nigeria", "NI": "Nicaragua", "NL": "Netherlands",
    "NO": "Norway", "NP": "Nepal", "NR": "Nauru", "NU": "Niue", "NZ": "New Zealand",
    "OM": "Oman", "PA": "Panama", "PE": "Peru", "PF": "French Polynesia",
    "PG": "Papua New Guinea", "PH": "Philippines", "PK": "Pakistan", "PL": "Poland",
    "PM": "Saint Pierre and Miquelon", "PN": "Pitcairn Islands", "PR": "Puerto Rico",
    "PS": "Palestine", "PT": "Portugal", "PW": "Palau", "PY": "Paraguay",
    "QA": "Qatar", "RE": "Réunion", "RO": "Romania", "RS": "Serbia", "RU": "Russia",
    "RW": "Rwanda", "SA": "Saudi Arabia", "SB": "Solomon Islands", "SC": "Seychelles",
    "SD": "Sudan", "SE": "Sweden", "SG": "Singapore", "SH": "Saint Helena",
    "SI": "Slovenia", "SJ": "Svalbard and Jan Mayen", "SK": "Slovakia",
    "SL": "Sierra Leone", "SM": "San Marino", "SN": "Senegal", "SO": "Somalia",
    "SR": "Suriname", "SS": "South Sudan", "ST": "São Tomé and Príncipe",
    "SV": "El Salvador", "SX": "Sint Maarten", "SY": "Syria", "SZ": "Eswatini",
    "TC": "Turks and Caicos Islands", "TD": "Chad",
    "TF": "French Southern and Antarctic Lands", "TG": "Togo", "TH": "Thailand",
    "TJ": "Tajikistan", "TK": "Tokelau", "TL": "Timor-Leste", "TM": "Turkmenistan",
    "TN": "Tunisia", "TO": "Tonga", "TR": "Turkey", "TT": "Trinidad and Tobago",
    "TV": "Tuvalu", "TW": "Taiwan", "TZ": "Tanzania", "UA": "Ukraine", "UG": "Uganda",
    "UM": "United States Minor Outlying Islands", "US": "United States",
    "UY": "Uruguay", "UZ": "Uzbekistan", "VA": "Vatican City",
    "VC": "Saint Vincent and the Grenadines", "VE": "Venezuela",
    "VG": "British Virgin Islands", "VI": "United States Virgin Islands",
    "VN": "Vietnam", "VU": "Vanuatu", "WF": "Wallis and Futuna", "WS": "Samoa",
    "XK": "Kosovo", "YE": "Yemen", "YT": "Mayotte", "ZA": "South Africa",
    "ZM": "Zambia", "ZW": "Zimbabwe",
}

#: Other ways a guide writes a country, mapped to the name above. "New
#: Mexico" is here so a sentence about Santa Fe is not read as Mexico.
ALIASES: dict[str, str] = {
    "USA": "United States", "U.S.": "United States", "U.S.A.": "United States",
    "United States of America": "United States", "New Mexico": "United States",
    "UK": "United Kingdom", "Great Britain": "United Kingdom", "Britain": "United Kingdom",
    "England": "United Kingdom", "Scotland": "United Kingdom", "Wales": "United Kingdom",
    "Northern Ireland": "United Kingdom", "Holland": "Netherlands",
    "The Netherlands": "Netherlands", "Czechia": "Czech Republic", "Burma": "Myanmar",
    "Côte d'Ivoire": "Ivory Coast", "Cote d'Ivoire": "Ivory Coast",
    "Swaziland": "Eswatini", "Macedonia": "North Macedonia", "Viet Nam": "Vietnam",
    "Korea": "South Korea", "Republic of Korea": "South Korea", "Brasil": "Brazil",
    "México": "Mexico", "Türkiye": "Turkey", "East Timor": "Timor-Leste",
    "DR Congo": "Democratic Republic of the Congo",
    "Congo-Kinshasa": "Democratic Republic of the Congo",
    "Congo-Brazzaville": "Republic of the Congo", "Congo": "Republic of the Congo",
    "Cabo Verde": "Cape Verde", "The Gambia": "Gambia", "The Bahamas": "Bahamas",
    "UAE": "United Arab Emirates", "Emirates": "United Arab Emirates",
    "St. Lucia": "Saint Lucia", "St Lucia": "Saint Lucia",
    "St. Kitts and Nevis": "Saint Kitts and Nevis",
    "St. Vincent and the Grenadines": "Saint Vincent and the Grenadines",
    "Vatican": "Vatican City", "Russian Federation": "Russia",
    "Lao PDR": "Laos", "People's Republic of China": "China", "PRC": "China",
    "Federated States of Micronesia": "Micronesia", "Macao": "Macau",
    "Bosnia": "Bosnia and Herzegovina", "Curacao": "Curaçao", "Reunion": "Réunion",
    "Sao Tome and Principe": "São Tomé and Príncipe", "Aland Islands": "Åland Islands",
}

#: How a guide calls a country when it is describing something in it: "the
#: capital of the Mexican state of Oaxaca". Only the forms that read as one
#: country; "American" is left out because of Central and South America.
DEMONYMS: dict[str, str] = {
    "Mexican": "Mexico", "Guatemalan": "Guatemala", "Belizean": "Belize",
    "Honduran": "Honduras", "Salvadoran": "El Salvador", "Nicaraguan": "Nicaragua",
    "Costa Rican": "Costa Rica", "Panamanian": "Panama", "Colombian": "Colombia",
    "Venezuelan": "Venezuela", "Ecuadorian": "Ecuador", "Peruvian": "Peru",
    "Bolivian": "Bolivia", "Chilean": "Chile", "Argentine": "Argentina",
    "Argentinian": "Argentina", "Brazilian": "Brazil", "Uruguayan": "Uruguay",
    "Paraguayan": "Paraguay", "Cuban": "Cuba", "Jamaican": "Jamaica",
    "Dominican": "Dominican Republic", "Canadian": "Canada", "Spanish": "Spain",
    "Portuguese": "Portugal", "French": "France", "Italian": "Italy", "German": "Germany",
    "Dutch": "Netherlands", "Belgian": "Belgium", "Swiss": "Switzerland",
    "Austrian": "Austria", "British": "United Kingdom", "English": "United Kingdom",
    "Scottish": "United Kingdom", "Welsh": "United Kingdom", "Irish": "Ireland",
    "Greek": "Greece", "Turkish": "Turkey", "Croatian": "Croatia", "Slovenian": "Slovenia",
    "Czech": "Czech Republic", "Polish": "Poland", "Hungarian": "Hungary",
    "Romanian": "Romania", "Bulgarian": "Bulgaria", "Serbian": "Serbia",
    "Albanian": "Albania", "Norwegian": "Norway", "Swedish": "Sweden", "Danish": "Denmark",
    "Finnish": "Finland", "Icelandic": "Iceland", "Estonian": "Estonia",
    "Latvian": "Latvia", "Lithuanian": "Lithuania", "Ukrainian": "Ukraine",
    "Georgian": "Georgia", "Armenian": "Armenia", "Moroccan": "Morocco",
    "Tunisian": "Tunisia", "Egyptian": "Egypt", "Kenyan": "Kenya", "Tanzanian": "Tanzania",
    "Ugandan": "Uganda", "Rwandan": "Rwanda", "Ethiopian": "Ethiopia",
    "South African": "South Africa", "Namibian": "Namibia", "Israeli": "Israel",
    "Jordanian": "Jordan", "Lebanese": "Lebanon", "Omani": "Oman",
    "Emirati": "United Arab Emirates",
    "Iranian": "Iran", "Indian": "India", "Nepali": "Nepal", "Nepalese": "Nepal",
    "Sri Lankan": "Sri Lanka", "Pakistani": "Pakistan", "Bangladeshi": "Bangladesh",
    "Thai": "Thailand", "Vietnamese": "Vietnam", "Cambodian": "Cambodia", "Lao": "Laos",
    "Laotian": "Laos", "Malaysian": "Malaysia", "Singaporean": "Singapore",
    "Indonesian": "Indonesia", "Filipino": "Philippines", "Philippine": "Philippines",
    "Chinese": "China", "Taiwanese": "Taiwan", "Japanese": "Japan", "Korean": "South Korea",
    "Mongolian": "Mongolia", "Australian": "Australia", "New Zealand's": "New Zealand",
    "Fijian": "Fiji",
}


def _fold(text: str) -> str:
    """Case and accents folded, so "méxico" and "Mexico" read as one word."""
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch)).casefold()


_BY_FOLDED: dict[str, str] = {
    **{_fold(name): name for name in ISO_TO_NAME.values()},
    **{_fold(alias): name for alias, name in ALIASES.items()},
    **{_fold(demonym): name for demonym, name in DEMONYMS.items()},
}

# Longest first, so "Papua New Guinea" is matched before "Guinea" and
# "South Sudan" before "Sudan"; word boundaries, so "Niger" is not "Nigeria".
_PATTERN = re.compile(
    r"(?<![\w])("
    + "|".join(re.escape(key) for key in sorted(_BY_FOLDED, key=len, reverse=True))
    + r")(?![\w])"
)


def country_from_code(code: str | None) -> str | None:
    """The name for an ISO code, or nothing for an unknown or empty one."""
    return ISO_TO_NAME.get((code or "").strip().upper()) or None


def as_country(text: str | None) -> str | None:
    """The country `text` names, if it names exactly one and nothing else."""
    folded = _fold((text or "").strip())
    return _BY_FOLDED.get(folded)


def find_country(text: str | None) -> str | None:
    """The first country named in `text`, or nothing.

    First, not most frequent: a guide's opening sentence says where a place is
    before it says what it is near, so "a town in Guatemala near the border
    with Belize" is in Guatemala.
    """
    if not text:
        return None
    match = _PATTERN.search(_fold(text))
    return _BY_FOLDED[match.group(1)] if match else None
