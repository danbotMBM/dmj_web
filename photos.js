const photolist = [
    { 'filename': 'milfordsound.jpg', 'description': 'view from Gertrude\'s Saddle', 'location': 'Milford Sound, New Zealand' },
    { 'filename': 'tokyogreenhouse.jpg', 'description': '', 'location': 'Tokyo, Japan' },
    { 'filename': 'batsinleaf.jpg', 'description': 'bats hanging from a leaf', 'location': 'Costa Rica' },
    { 'filename': 'bluffcitiessign.jpg', 'description': 'sign pointing to major cities', 'location': 'Bluff, New Zealand' },
    { 'filename': 'yellowrose.jpg', 'description': 'yellow rose in public park', 'location': 'Queenstown, New Zealand' },
    { 'filename': 'cefalutown.jpg', 'description': 'Italian rooftops', 'location': 'Cefalu, Italy' },
    { 'filename': 'franconianotch.jpg', 'description': 'Franconia Notch State Park', 'location': 'New Hampshire' },
    { 'filename': 'temple.jpg', 'description': 'Doric temple', 'location': 'Agrigento, Italy' },
    { 'filename': 'madrid.jpg', 'description': '', 'location': '' },
    { 'filename': 'aurthursseatview.jpg', 'description': 'view from Arthur\'s Seat', 'location': 'Edinburgh, Scotland' },
    { 'filename': 'kamikochimountains.jpg', 'description': '', 'location': 'Kamikochi, Japan' },
    { 'filename': 'cozybirds.jpg', 'description': '', 'location': '' },
    { 'filename': 'japanesedeer.jpg', 'description': '', 'location': 'Hiroshima, Japan' },
    { 'filename': 'castle.jpg', 'description': '', 'location': '' },
    { 'filename': 'kea.jpg', 'description': 'kea, a bird only native to New Zealand', 'location': 'Queenstown, New Zealand' },
    { 'filename': 'queenstown.jpg', 'description': 'overlook of the town center', 'location': 'Queenstown, New Zealand' },
    { 'filename': 'japanwindmill.jpg', 'description': '', 'location': 'Kochi, Japan' },
    { 'filename': 'cranes.jpg', 'description': '', 'location': 'Osaka, Japan' },
    { 'filename': 'skybarskyline.jpg', 'description': '', 'location': 'Tokyo, Japan' },
    { 'filename': 'deathvalleyhills.jpg', 'description': '', 'location': 'Death Valley, Nevada' },
    { 'filename': 'hotairbaloons.jpg', 'description': '', 'location': 'Myanmar' },
    { 'filename': 'skytree.jpg', 'description': 'view of Skytree', 'location': 'Tokyo, Japan' },
    { 'filename': 'meijijinju.jpg', 'description': 'Meiji Jinju gate', 'location': 'Tokyo, Japan' },
    { 'filename': 'porschemini.jpg', 'description': '', 'location': 'Tokyo, Japan' },
    { 'filename': 'yellowbuilding.jpg', 'description': '', 'location': 'Oslo, Norway' },
    { 'filename': 'lighthouse.jpg', 'description': 'lighthouse', 'location': 'Waipapa Point, New Zealand' },
    { 'filename': 'roastduck.jpg', 'description': 'roast duck at Mt. Albert BBQ Noodle house', 'location': 'Auckland, New Zealand' },
    { 'filename': 'fishalley.jpg', 'description': '', 'location': '' },
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
    { 'filename': 'littleplane.jpg', 'description': '', 'location': '' },
    { 'filename': 'lighthousebulb.jpg', 'description': 'lighthouse beacon', 'location': 'Bristol, Maine' },
    { 'filename': 'fushimiinaritower.jpg', 'description': '', 'location': 'Kyoto, Japan' },
    { 'filename': 'hazeymoon.jpg', 'description': '', 'location': '' },s
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
    { 'filename': 'gatetunnel.jpg', 'description': '', 'location': 'Kyoto, Japan' },
    { 'filename': 'seagull.jpg', 'description': '', 'location': 'San Francisco, California' },
    { 'filename': 'treebark.jpg', 'description': '', 'location': 'San Francisco, California' },
    { 'filename': 'pinkflowers.jpg', 'description': '', 'location': 'Dallas, Texas' },
    { 'filename': 'sydneyoperahouse.jpg', 'description': '', 'location': 'Sydney, Australia' },
    { 'filename': 'kangaroo.jpg', 'description': '', 'location': 'Australia' },
    { 'filename': 'biblereading.jpg', 'description': '', 'location': 'Gold Coast, Australia' },
];

// Generate a random integer between 1 and 30
function getRandomInteger(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function get_photos(){
    return photolist;
}

function get_one_random_photo(){
    var randomNumber = getRandomInteger(0, photolist.length - 1);
    return photolist[randomNumber];
}

function get_title(p){
    if (p.description != '' && p.location != ''){
        return p.description + " in " + p.location;
    }else{
        return p.description + p.location;
    }
}
