const photolist = [
    { 'filename': 'souk.jpg', 'description': '', 'location': 'Marrakech, Morocco' },
    { 'filename': 'milfordsound.jpg', 'description': 'view from Gertrude\'s Saddle', 'location': 'Milford Sound, New Zealand' },
    { 'filename': 'garbagecharizard.jpg', 'description': '', 'location': 'New York City' },
    { 'filename': 'tokyogreenhouse.jpg', 'description': '', 'location': 'Tokyo, Japan' },
    { 'filename': 'batsinleaf.jpg', 'description': 'bats hanging from a leaf', 'location': 'Costa Rica' },
    { 'filename': 'arabcontroltower.jpg', 'description': '', 'location': 'Ouarzazate, Morocco' },
    { 'filename': 'bluffcitiessign.jpg', 'description': 'sign pointing to major cities', 'location': 'Bluff, New Zealand' },
    { 'filename': 'yellowrose.jpg', 'description': 'yellow rose in public park', 'location': 'Queenstown, New Zealand' },
    { 'filename': 'cefalutown.jpg', 'description': 'Italian rooftops', 'location': 'Cefalu, Italy' },
    { 'filename': 'sagradafamilia.jpg', 'description': 'Sagrada Familia', 'location': 'Barcelona, Spain' },
    { 'filename': 'franconianotch.jpg', 'description': 'Franconia Notch State Park', 'location': 'New Hampshire' },
    { 'filename': 'temple.jpg', 'description': 'Doric temple', 'location': 'Agrigento, Italy' },
    { 'filename': 'madrid.jpg', 'description': '', 'location': 'Madrid, Spain' },
    { 'filename': 'saharasunset.jpg', 'description': 'sunset over the dunes', 'location': 'Sahara, Morocco' },
    { 'filename': 'aurthursseatview.jpg', 'description': 'view from Arthur\'s Seat', 'location': 'Edinburgh, Scotland' },
    { 'filename': 'kamikochimountains.jpg', 'description': '', 'location': 'Kamikochi, Japan' },
    { 'filename': 'cozybirds.jpg', 'description': '', 'location': 'Enoshima, Japan' },
    { 'filename': 'japanesedeer.jpg', 'description': '', 'location': 'Hiroshima, Japan' },
    { 'filename': 'mosque.jpg', 'description': '', 'location': 'Marrakech, Morocco' },
    { 'filename': 'castle.jpg', 'description': '', 'location': 'Aci Castello, Italy' },
    { 'filename': 'kea.jpg', 'description': 'kea, a bird only native to New Zealand', 'location': 'Queenstown, New Zealand' },
    { 'filename': 'queenstown.jpg', 'description': 'overlook of the town center', 'location': 'Queenstown, New Zealand' },
    { 'filename': 'spiralstairs.jpg', 'description': 'spiral staircase', 'location': 'Barcelona, Spain' },
    { 'filename': 'japanwindmill.jpg', 'description': '', 'location': 'Kochi, Japan' },
    { 'filename': 'cranes.jpg', 'description': '', 'location': 'Osaka, Japan' },
    { 'filename': 'skybarskyline.jpg', 'description': '', 'location': 'Tokyo, Japan' },
    { 'filename': 'deathvalleyhills.jpg', 'description': '', 'location': 'Death Valley, Nevada' },
    { 'filename': 'hotairbaloons.jpg', 'description': '', 'location': 'Myanmar' },
    { 'filename': 'skytree.jpg', 'description': 'view of Skytree', 'location': 'Tokyo, Japan' },
    { 'filename': 'meijijinju.jpg', 'description': 'Meiji Jinju gate', 'location': 'Tokyo, Japan' },
    { 'filename': 'morocco.jpg', 'description': '', 'location': 'Marrakech, Morocco' },
    { 'filename': 'porschemini.jpg', 'description': '', 'location': 'Tokyo, Japan' },
    { 'filename': 'yellowbuilding.jpg', 'description': '', 'location': 'Oslo, Norway' },
    { 'filename': 'lighthouse.jpg', 'description': 'lighthouse', 'location': 'Waipapa Point, New Zealand' },
    { 'filename': 'roastduck.jpg', 'description': 'roast duck at Mt. Albert BBQ Noodle house', 'location': 'Auckland, New Zealand' },
    { 'filename': 'fishalley.jpg', 'description': '', 'location': 'Tokyo, Japan' },
    { 'filename': 'aurthursseatflowers.jpg', 'description': 'view of Arthur\' Seat', 'location': 'Edinburgh, Scotland' },
    { 'filename': 'glacier.jpg', 'description': '', 'location': 'Norway' },
    { 'filename': 'beachrocks.jpg', 'description': 'beach rocks', 'location': 'Bluff, New Zealand' },
    { 'filename': 'bergenview.jpg', 'description': '', 'location': 'Bergen, Norway' },
    { 'filename': 'mountainpath.jpg', 'description': '', 'location': 'Norway' },
    { 'filename': 'cefalucliff.jpg', 'description': 'rocky cliff', 'location': 'Cefalu, Italy' },
    { 'filename': 'hermitcrabs.jpg', 'description': '', 'location': 'Costa Rica' },
    { 'filename': 'calderalake.jpg', 'description': 'caldera lake', 'location': 'Costa Rica' },
    { 'filename': 'oslooperahouse.jpg', 'description': 'Oslo Opera House', 'location': 'Oslo, Norway' },
    { 'filename': 'deathvalleyrocks.jpg', 'description': '', 'location': 'Death Valley, Nevada' },
    { 'filename': 'fushimiinaribuilding.jpg', 'description': '', 'location': 'Kyoto, Japan' },
    { 'filename': 'bristolrock.jpg', 'description': 'coastal rock', 'location': 'Bristol, Maine' },
    { 'filename': 'horseshoebendrocks.jpg', 'description': '', 'location': 'Horseshoe Bend, Arizona' },
    { 'filename': 'familymonument.jpg', 'description': '', 'location': 'Myanmar' },
    { 'filename': 'littleplane.jpg', 'description': '', 'location': 'Pokhara, Nepal' },
    { 'filename': 'lighthousebulb.jpg', 'description': 'lighthouse beacon', 'location': 'Bristol, Maine' },
    { 'filename': 'fushimiinaritower.jpg', 'description': '', 'location': 'Kyoto, Japan' },
    { 'filename': 'hazeymoon.jpg', 'description': '', 'location': 'Nepal' },
    { 'filename': 'nepalsafarirhino.jpg', 'description': '', 'location': 'Nepal' },
    { 'filename': 'whitesandsselfie.jpg', 'description': '', 'location': 'White Sands, New Mexico' },
    { 'filename': 'slotcanyoneye.jpg', 'description': '', 'location': 'Utah' },
    { 'filename': 'whitesandssunrise.jpg', 'description': '', 'location': 'White Sands, New Mexico' },
    { 'filename': 'victoriafalls.jpg', 'description': '', 'location': 'Victoria Falls, Zimbabwe' },
    { 'filename': 'templefox.jpg', 'description': '', 'location': 'Kyoto, Japan' },
    { 'filename': 'overflowingrocknz.jpg', 'description': 'wave enveloping rock on beach', 'location': 'Waipapa Point, New Zealand' },
    { 'filename': 'tunnel.jpg', 'description': '', 'location': 'Vietnam' },
    { 'filename': 'nepalsafaribrush.jpg', 'description': '', 'location': 'Nepal' },
    { 'filename': 'mossylight.jpg', 'description': '', 'location': 'Vietnam' },
    { 'filename': 'halongbayisland.jpg', 'description': '', 'location': 'Vietnam' },
    { 'filename': 'crackeddirt.jpg', 'description': '', 'location': 'Seattle, Washington' },
    { 'filename': 'mtrainier.jpg', 'description': '', 'location': 'Seattle, Washington' },
    { 'filename': 'nepalsafarielephant.jpg', 'description': '', 'location': 'Nepal' },
    { 'filename': 'spaceneedle.jpg', 'description': '', 'location': 'Seattle, Washington' },
    { 'filename': 'sydneyoperahousefireworks.jpg', 'description': '', 'location': 'Sydney, Australia' },
    { 'filename': 'slotcanyonwall.jpg', 'description': '', 'location': 'Utah' },
    { 'filename': 'stoplightbokeh.jpg', 'description': '', 'location': 'Dallas, Texas' },
    { 'filename': 'exitstairs.jpg', 'description': '', 'location': 'Dallas, Texas' },
    { 'filename': 'highwaylongexposure.jpg', 'description': '', 'location': 'Dallas, Texas' },
    { 'filename': 'experimentalhelicopter.jpg', 'description': '', 'location': 'Dallas, Texas' },
    { 'filename': 'mountfuji.jpg', 'description': '', 'location': 'Lake Ashi, Japan' },
    { 'filename': 'americanflag.jpg', 'description': '', 'location': 'San Francisco, California' },
    { 'filename': 'carrousel.jpg', 'description': '', 'location': 'San Francisco, California' },
    { 'filename': 'palmtree.jpg', 'description': '', 'location': 'Morocco' },
    { 'filename': 'gatetunnel.jpg', 'description': '', 'location': 'Kyoto, Japan' },
    { 'filename': 'seagull.jpg', 'description': '', 'location': 'San Francisco, California' },
    { 'filename': 'treebark.jpg', 'description': '', 'location': 'San Francisco, California' },
    { 'filename': 'pinkflowers.jpg', 'description': '', 'location': 'Dallas, Texas' },
    { 'filename': 'sydneyoperahouse.jpg', 'description': '', 'location': 'Sydney, Australia' },
    { 'filename': 'kangaroo.jpg', 'description': '', 'location': 'Australia' },
    { 'filename': 'biblereading.jpg', 'description': '', 'location': 'Gold Coast, Australia' },
];

// API base URL (kept in sync with utils.js; photos.js loads as a classic
// script so it can't import the module export).
const PHOTOS_API_BASE = 'https://api.danbotlab';

// Photos are stored server-side (focal points are edited via the admin tool).
// The hardcoded `photolist` above is a fallback used only if the API is
// unreachable, so the site still renders. Loaded photos are cached so each
// page fetches once.
let _photoCache = null;

// Generate a random integer between 1 and 30
function getRandomInteger(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Fetch the photo list (with focal points) once, falling back to the inline
// list if the API is down. Returns a Promise resolving to the array.
async function load_photos() {
    if (_photoCache) return _photoCache;
    try {
        const res = await fetch(`${PHOTOS_API_BASE}/photos`);
        if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data) && data.length > 0) {
                _photoCache = data;
                return _photoCache;
            }
        }
    } catch (e) {
        console.warn('photos: falling back to inline list', e);
    }
    _photoCache = photolist;
    return _photoCache;
}

async function get_photos(){
    return await load_photos();
}

async function get_one_random_photo(){
    const list = await load_photos();
    return list[getRandomInteger(0, list.length - 1)];
}

// CSS object-position value for a photo's focal point. With object-fit: cover
// this keeps the same point centered across every crop aspect ratio.
function focal_position(p){
    return `${p.posX ?? 50}% ${p.posY ?? 50}%`;
}

function get_title(p){
    if (p.description != '' && p.location != ''){
        return p.description + " in " + p.location;
    }else{
        return p.description + p.location;
    }
}
