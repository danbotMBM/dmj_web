import { API_BASE } from "/utils.js";

// Photos (with focal points) are stored server-side and edited via the admin
// tool — the API is the single source of truth for the photo list. The result
// is cached so each page only fetches once.
let _photoCache = null;

// Generate a random integer between min and max (inclusive)
function getRandomInteger(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Fetch the photo list (with focal points) once. Resolves to the array, or an
// empty array if the API is unreachable. Failures are not cached, so a later
// call can retry.
async function load_photos() {
    if (_photoCache) return _photoCache;
    try {
        const res = await fetch(`${API_BASE}/photos`);
        if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data) && data.length > 0) {
                _photoCache = data;
                return _photoCache;
            }
        }
    } catch (e) {
        console.warn('photos: failed to load photo list', e);
    }
    return [];
}

async function get_photos(){
    return await load_photos();
}

async function get_one_random_photo(){
    const list = await load_photos();
    if (list.length === 0) return null;
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

export { get_photos, get_one_random_photo, focal_position, get_title };
