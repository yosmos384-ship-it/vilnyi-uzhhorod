#!/usr/bin/env python3
"""Offline JSON-LD validator for the ЖК VILNYI pages (no network).

Two layers:
 1. schema.org vocabulary: every node's @type must be known and every property must be defined for that type (a
    hand-copied subset of schema.org — the types this site uses, with inherited properties), plus value checks
    (numbers, ISO dates, currency codes, absolute URLs, unitCode).
 2. Google rich-result requirements expressed as JSON Schemas and checked with the `jsonschema` library
    (FAQPage/Question/Answer, BreadcrumbList/ListItem, Offer/AggregateOffer, Organization, ApartmentComplex/Place).
Usage: python3 seo-bot/jsonld_check.py <file.html> …   (exit 1 on any error)
"""
import json, re, sys
from jsonschema import Draft202012Validator

THING = {'@id', '@type', '@context', 'name', 'alternateName', 'description', 'url', 'image', 'sameAs', 'identifier', 'mainEntityOfPage', 'additionalType', 'potentialAction', 'subjectOf', 'disambiguatingDescription'}
PLACE = THING | {'address', 'geo', 'hasMap', 'containsPlace', 'containedInPlace', 'amenityFeature', 'additionalProperty', 'telephone', 'photo', 'publicAccess', 'latitude', 'longitude', 'openingHoursSpecification', 'logo', 'isAccessibleForFree', 'maximumAttendeeCapacity', 'smokingAllowed', 'tourBookingPage', 'keywords', 'slogan', 'faxNumber', 'globalLocationNumber', 'branchCode', 'specialOpeningHoursSpecification'}
ACCOM = PLACE | {'floorSize', 'numberOfRooms', 'numberOfBathroomsTotal', 'numberOfBedrooms', 'numberOfFullBathrooms', 'numberOfPartialBathrooms', 'accommodationFloorPlan', 'floorLevel', 'occupancy', 'petsAllowed', 'yearBuilt', 'leaseLength', 'permittedUsage', 'accommodationCategory', 'bed'}
ORG = THING | {'logo', 'email', 'contactPoint', 'telephone', 'address', 'founder', 'foundingDate', 'parentOrganization', 'subOrganization', 'brand', 'legalName', 'areaServed', 'location', 'member', 'numberOfEmployees', 'vatID', 'taxID', 'department', 'knowsLanguage'}
CREATIVE = THING | {'inLanguage', 'publisher', 'author', 'about', 'isPartOf', 'dateModified', 'datePublished', 'headline', 'keywords', 'mainEntity', 'creditText', 'copyrightHolder', 'thumbnailUrl', 'text', 'hasPart', 'license', 'audience', 'contentLocation', 'genre'}
WEBPAGE = CREATIVE | {'breadcrumb', 'primaryImageOfPage', 'lastReviewed', 'significantLink', 'speakable', 'relatedLink', 'reviewedBy', 'mainContentOfPage'}
MEDIA = CREATIVE | {'contentUrl', 'width', 'height', 'uploadDate', 'encodingFormat', 'caption', 'embedUrl', 'contentSize', 'representativeOfPage'}
PRICESPEC = THING | {'price', 'priceCurrency', 'validFrom', 'validThrough', 'minPrice', 'maxPrice', 'eligibleQuantity', 'valueAddedTaxIncluded'}
OFFER = THING | {'price', 'priceCurrency', 'priceSpecification', 'itemOffered', 'seller', 'offeredBy', 'validFrom', 'validThrough', 'priceValidUntil', 'availability', 'eligibleQuantity', 'inventoryLevel', 'businessFunction', 'areaServed', 'category', 'availabilityStarts'}
LIST = THING | {'itemListElement', 'numberOfItems', 'itemListOrder'}
VOCAB = {
    'Thing': THING, 'Place': PLACE, 'Residence': ACCOM | PLACE, 'ApartmentComplex': PLACE | {'accommodationFloorPlan', 'numberOfAccommodationUnits', 'numberOfAvailableAccommodationUnits', 'numberOfBedrooms', 'petsAllowed', 'tourBookingPage'},
    'Accommodation': ACCOM, 'Apartment': ACCOM, 'ParkingFacility': PLACE | {'openingHours'}, 'FloorPlan': THING | {'floorSize', 'numberOfRooms', 'numberOfBathroomsTotal', 'numberOfBedrooms', 'numberOfFullBathrooms', 'numberOfPartialBathrooms', 'layoutImage', 'isPlanForApartment', 'amenityFeature', 'petsAllowed', 'numberOfAvailableAccommodationUnits', 'numberOfAccommodationUnits'},
    'Organization': ORG, 'LocalBusiness': ORG | PLACE | {'openingHours', 'priceRange', 'currenciesAccepted', 'paymentAccepted'},
    'ContactPoint': THING | {'telephone', 'contactType', 'areaServed', 'availableLanguage', 'email', 'hoursAvailable', 'contactOption', 'productSupported'},
    'WebSite': CREATIVE | {'issn'}, 'WebPage': WEBPAGE, 'CollectionPage': WEBPAGE, 'AboutPage': WEBPAGE, 'ContactPage': WEBPAGE, 'FAQPage': WEBPAGE,
    'ImageGallery': WEBPAGE | {'image'}, 'ImageObject': MEDIA | {'exifData', 'embeddedTextCaption'},
    'Question': CREATIVE | {'acceptedAnswer', 'suggestedAnswer', 'answerCount'}, 'Answer': CREATIVE | {'upvoteCount', 'parentItem'},
    'BreadcrumbList': LIST, 'ItemList': LIST, 'ListItem': THING | {'position', 'item', 'nextItem', 'previousItem'},
    'Offer': OFFER, 'AggregateOffer': OFFER | {'lowPrice', 'highPrice', 'offerCount', 'offers'},
    'UnitPriceSpecification': PRICESPEC | {'referenceQuantity', 'unitCode', 'unitText', 'priceType', 'billingDuration'},
    'QuantitativeValue': THING | {'value', 'unitCode', 'unitText', 'minValue', 'maxValue'}, 'PropertyValue': THING | {'value', 'unitCode', 'unitText', 'propertyID', 'minValue', 'maxValue'},
    'LocationFeatureSpecification': THING | {'value', 'unitCode', 'unitText', 'propertyID', 'hoursAvailable', 'validFrom', 'validThrough'},
    'GeoCoordinates': THING | {'latitude', 'longitude', 'elevation', 'address', 'addressCountry', 'postalCode'},
    'PostalAddress': THING | {'streetAddress', 'addressLocality', 'addressRegion', 'addressCountry', 'postalCode', 'postOfficeBoxNumber', 'telephone', 'email'},
    'OpeningHoursSpecification': THING | {'dayOfWeek', 'opens', 'closes', 'validFrom', 'validThrough'},
}
URL_PROPS = {'url', 'logo', 'hasMap', 'tourBookingPage', 'contentUrl', 'thumbnailUrl', 'layoutImage', 'item'}
NUM_PROPS = {'price', 'lowPrice', 'highPrice', 'latitude', 'longitude', 'numberOfRooms', 'numberOfBathroomsTotal', 'numberOfAccommodationUnits', 'offerCount', 'position', 'width', 'height', 'numberOfItems'}
DATE_PROPS = {'dateModified', 'datePublished', 'validFrom', 'uploadDate', 'priceValidUntil'}
DAYS = {'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'}

S_STR = {'type': 'string', 'minLength': 1}
GOOGLE = {   # rich-result requirements (developers.google.com/search/docs/appearance/structured-data), as JSON Schema
    'FAQPage': {'type': 'object', 'required': ['mainEntity'], 'properties': {'mainEntity': {'type': 'array', 'minItems': 1, 'items': {'type': 'object', 'required': ['@type', 'name', 'acceptedAnswer'], 'properties': {'@type': {'const': 'Question'}, 'name': S_STR, 'acceptedAnswer': {'type': 'object', 'required': ['@type', 'text'], 'properties': {'@type': {'const': 'Answer'}, 'text': S_STR}}}}}}},
    'BreadcrumbList': {'type': 'object', 'required': ['itemListElement'], 'properties': {'itemListElement': {'type': 'array', 'minItems': 1, 'items': {'type': 'object', 'required': ['@type', 'position', 'name', 'item'], 'properties': {'@type': {'const': 'ListItem'}, 'position': {'type': 'integer', 'minimum': 1}, 'name': S_STR, 'item': {'type': 'string', 'pattern': '^https://'}}}}}},
    'Offer': {'type': 'object', 'required': ['price', 'priceCurrency', 'itemOffered'], 'properties': {'price': {'type': 'number', 'exclusiveMinimum': 0}, 'priceCurrency': {'type': 'string', 'pattern': '^[A-Z]{3}$'}}},
    'AggregateOffer': {'type': 'object', 'required': ['lowPrice', 'priceCurrency', 'offerCount'], 'properties': {'lowPrice': {'type': 'number', 'exclusiveMinimum': 0}, 'highPrice': {'type': 'number'}, 'offerCount': {'type': 'integer', 'minimum': 1}, 'priceCurrency': {'type': 'string', 'pattern': '^[A-Z]{3}$'}}},
    'Organization': {'type': 'object', 'required': ['name', 'url'], 'properties': {'url': {'type': 'string', 'pattern': '^https://'}}},
    'ApartmentComplex': {'type': 'object', 'required': ['name', 'address', 'geo'], 'properties': {'address': {'type': 'object', 'required': ['streetAddress', 'addressLocality', 'addressCountry']}, 'geo': {'type': 'object', 'required': ['latitude', 'longitude']}}},
    'Apartment': {'type': 'object', 'required': ['name', 'floorSize', 'numberOfRooms'], 'properties': {'floorSize': {'type': 'object', 'required': ['unitCode'], 'anyOf': [{'required': ['value']}, {'required': ['minValue', 'maxValue']}], 'properties': {'value': {'type': 'number', 'exclusiveMinimum': 0}, 'minValue': {'type': 'number'}, 'maxValue': {'type': 'number'}, 'unitCode': {'const': 'MTK'}}}}},
    'LocalBusiness': {'type': 'object', 'required': ['name', 'address'], 'properties': {'address': {'type': 'object', 'required': ['streetAddress', 'addressLocality', 'addressCountry']}}},
    'WebPage': {'type': 'object', 'required': ['url', 'name', 'inLanguage']},
}
VALIDATORS = {k: Draft202012Validator(v) for k, v in GOOGLE.items()}
for k in ('CollectionPage', 'AboutPage', 'ContactPage', 'FAQPage'):
    if k != 'FAQPage': VALIDATORS[k] = VALIDATORS['WebPage']


def check_node(node, where, errs, ids):
    if isinstance(node, list):
        for i, n in enumerate(node): check_node(n, f'{where}[{i}]', errs, ids)
        return
    if not isinstance(node, dict): return
    t = node.get('@type')
    if t is None:
        if set(node) - {'@id'}: errs.append(f'{where}: object without @type')
        elif node['@id'] not in ids: errs.append(f'{where}: reference {node["@id"]} not defined on the page')
        return
    for tt in (t if isinstance(t, list) else [t]):
        if tt not in VOCAB: errs.append(f'{where}: unknown @type {tt}'); continue
        bad = set(node) - VOCAB[tt]
        if bad: errs.append(f'{where} ({tt}): properties not defined for this type: {sorted(bad)}')
        if tt in VALIDATORS:
            for e in VALIDATORS[tt].iter_errors(node): errs.append(f'{where} ({tt}) google: {"/".join(map(str, e.path))} {e.message[:140]}')
    for k, v in node.items():
        if k in URL_PROPS and isinstance(v, str) and not v.startswith('https://'): errs.append(f'{where}.{k}: not an absolute https URL: {v[:80]}')
        if k in NUM_PROPS and not isinstance(v, (int, float)): errs.append(f'{where}.{k}: not a number: {v!r}'[:160])
        if k in DATE_PROPS and not (isinstance(v, str) and re.match(r'^\d{4}-\d{2}-\d{2}', v)): errs.append(f'{where}.{k}: not an ISO date: {v!r}')
        if k == 'priceCurrency' and not re.match(r'^[A-Z]{3}$', str(v)): errs.append(f'{where}.priceCurrency: {v!r}')
        if k == 'dayOfWeek' and not set(v if isinstance(v, list) else [v]) <= DAYS: errs.append(f'{where}.dayOfWeek: {v!r}')
        if k == 'inLanguage' and not all(re.match(r'^[a-z]{2}(-[A-Z]{2})?$', x) for x in (v if isinstance(v, list) else [v])): errs.append(f'{where}.inLanguage: {v!r}')
        if isinstance(v, (dict, list)): check_node(v, f'{where}.{k}', errs, ids)


def check_html(html):
    """→ (types found, errors)"""
    errs, types = [], []
    blocks = re.findall(r'<script type="application/ld\+json">(.*?)</script>', html, re.S)
    if not blocks: return types, ['no JSON-LD block']
    for i, b in enumerate(blocks):
        try: data = json.loads(b)
        except Exception as e: errs.append(f'block {i}: invalid JSON: {e}'); continue
        if data.get('@context') not in ('https://schema.org', 'https://schema.org/'): errs.append(f'block {i}: @context must be https://schema.org')
        nodes = data.get('@graph', [data])
        ids = set()
        def collect(n):
            if isinstance(n, dict):
                if '@id' in n and '@type' in n: ids.add(n['@id'])
                for v in n.values(): collect(v)
            elif isinstance(n, list):
                for v in n: collect(v)
        collect(nodes)
        for j, n in enumerate(nodes):
            types.append(n.get('@type'))
            check_node(n, f'block{i}.graph[{j}]', errs, ids)
    return types, errs


if __name__ == '__main__':
    bad = 0
    for f in sys.argv[1:]:
        types, errs = check_html(open(f, encoding='utf8').read())
        if errs: bad += 1; print(f, *errs[:10], sep='\n  ')
    print(f'{len(sys.argv) - 1} files, {bad} with errors')
    sys.exit(1 if bad else 0)
