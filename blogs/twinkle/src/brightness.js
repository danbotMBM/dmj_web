import { normalize } from "./utils.js"

// returns 0 - 1.0 where 1 is max brightness and 0 is no brightness
// upper bound designates the kelvin point where the brightness begins to become asymptotic to 1.0
export function get_brightness_from_kelvin(kelvin, upper_bound, upper_bound_damping_scale){
    if (kelvin > upper_bound){
        // above upper bound scales with asymptote
        return 0.9 + .1 * normalized_asymptotic_curve(kelvin-upper_bound, upper_bound_damping_scale);
    }
    const upper_bound_from_curve = brightness_from_kelvin_curve(upper_bound);
    // normalize to upper bound and treat upper bound as 90% brightness
    return 0.9 * normalize(brightness_from_kelvin_curve(kelvin), 0, upper_bound_from_curve);
}


// middle is where brightness is 0.5, quarter is where brightness is 0.25 
export function normalized_arctan(x, middle, quarter){
    var deviation = middle - quarter;
    if (deviation == 0){
        deviation = 1;
    }
    var s = 1/deviation;
    return (Math.atan(s*(x - middle)) + Math.PI/2) / Math.PI;
}

function normalized_asymptotic_curve(x, almost_no_change_point){
    if (almost_no_change_point == 0 || x < 0){
        console.log("ERROR: asymptotic curve defined incorrectly. x=",x,"cannot be < 0 and almost_no_change_point=", almost_no_change_point, "cannot be zero");
        return -1;
    }
    const denom = 9/almost_no_change_point;
    return -1/(denom*x + 1) + 1;
}

//bounds are around 0 - 5000
function brightness_from_kelvin_curve(kelvin){
    return 2.17e-15*Math.pow(kelvin, 4) + -1.08e-11 * Math.pow(kelvin, 3) + 1.54e-8 * Math.pow(kelvin, 2) + -4.63e-6 * kelvin + 5.92e-4;
}

function tests() {
    var t = []
    console.log("Testing brightness.js ...")
    // test the vibes of the curve of brightness
    t.push(brightness_from_kelvin_curve(0) < 0.001)
    t.push(brightness_from_kelvin_curve(1000) < 0.01)
    t.push(brightness_from_kelvin_curve(2000) < 0.01)
    t.push(brightness_from_kelvin_curve(3000) < 0.1)
    t.push(brightness_from_kelvin_curve(4000) < 0.5)
    t.push(brightness_from_kelvin_curve(5000) < 0.9)

    // test normalization
    t.push(normalize(5, 0, 10) == 0.5);
    t.push(normalize(0.1, 0, 1) == 0.1);
    t.push(normalize(0, 0, 1) == 0);
    t.push(normalize(1, 0, 1) == 1);
    t.push(normalize(1, 0, 0) == -1);

    //test normalzied_asumptotic_curve
    t.push(normalized_asymptotic_curve(10, 10) == 0.9);
    t.push(normalized_asymptotic_curve(0, 10) == 0);
    t.push(normalized_asymptotic_curve(100000000000, 10) < 1);
    t.push(normalized_asymptotic_curve(-1, 10) == -1);
    t.push(normalized_asymptotic_curve(1, 0) == -1);
    t.push(normalized_asymptotic_curve(100000000, -1) > 1);
    t.push(normalized_asymptotic_curve(100000000, -1) > 1);

    //test normalized_arctan
    t.push(normalized_arctan(100000000, 0,0) < 1);
    t.push(normalized_arctan(-100000000, 0,0) > 0);
    t.push(normalized_arctan(500, 500,0) == 0.5);
    t.push(normalized_arctan(504, 500, 496) == 0.75);
    t.push(normalized_arctan(400, 500, 400) == 0.25);

    let allTrue = t.every(e => e === true);
    if (allTrue) {
        console.log("All", t.length, "tests of brightness.js passed!")
    } else {
        for (let i = 0; i < t.length; i++) {
            if (!t[i]) {
                console.log("Test", i + 1, "/", t.length, "of brightness.js failed")
            }
        }
    }
    return allTrue
}
tests()