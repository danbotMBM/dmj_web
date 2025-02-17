import { Color } from "./color.js"
import { binary_search_between, array_equal } from "./utils.js";

const COLOR_CHECKPOINTS = new Map([
    [1000, new Color(0xFB1A00)],
    [1500, new Color(0xFE6901)],
    [2000, new Color(0xFC9D00)],
    [2500, new Color(0xFCCC28)],
    [3000, new Color(0xFFE64B)],
    [3500, new Color(0xFEF568)],
    [4000, new Color(0xFFFF96)],
    [4500, new Color(0xF1FFB1)],
    [5000, new Color(0xE6FECD)],
    [6000, new Color(0xD0FFFD)],
    [0, new Color(0x000000)],
]);

export function get_color_from_kelvin(kelvin, color_checkpoints = COLOR_CHECKPOINTS) {
    if (typeof (kelvin) != "number") {
        return null
    }
    var keys = color_checkpoints.keys()
    var keys = Array.from(keys)
    keys.sort();
    var res = binary_search_between(keys, kelvin);
    if (res === -1) {
        console.log("ERROR: invalid binary_search_between result, returning black by default");
        return new Color(0x000000);
    } else if (res[0] === res[1]) {
        //direct hit
        return color_checkpoints.get(kelvin);
    } else if (res[0] === -1) {
        //before first element
        return color_checkpoints.get(keys[0]);
    } else if (res[1] === keys.length) {
        //after last element
        return color_checkpoints.get(keys[keys.length - 1])
    }
    // is between 2 vals
    var kelvin_before = keys[res[0]];
    var kelvin_after = keys[res[1]];
    var proportion = (kelvin - kelvin_before) / (kelvin_after - kelvin_before);
    return Color.get_color_between(color_checkpoints.get(kelvin_before), color_checkpoints.get(kelvin_after), proportion);
}

function tests() {
    var temp_color_checkpoints = new Map([
        [1000, new Color(0xFB1A00)],
        [1500, new Color(0xFE6901)],
        [2000, new Color(0xFC9D00)],
        [2500, new Color(0xFCCC28)],
        [3000, new Color(0xFFE64B)],
        [3500, new Color(0xFEF568)],
        [4000, new Color(0xFFFF96)],
        [4500, new Color(0xF1FFB1)],
        [5000, new Color(0xE6FECD)],
        [6000, new Color(0xD0FFFD)],
        [0, new Color(0x000000)],
    ]);
    var t = []
    console.log("Testing color_scale.js ...")
    //Direct hits
    t.push(array_equal(get_color_from_kelvin(1500, temp_color_checkpoints).get_rgb(), [254, 105, 1]))
    t.push(array_equal(get_color_from_kelvin(0, temp_color_checkpoints).get_rgb(), [0, 0, 0]))
    t.push(array_equal(get_color_from_kelvin(6000, temp_color_checkpoints).get_rgb(), [208, 255, 253]))
    //Out of range
    t.push(array_equal(get_color_from_kelvin(-1, temp_color_checkpoints).get_rgb(), [0, 0, 0]))
    t.push(array_equal(get_color_from_kelvin(12700, temp_color_checkpoints).get_rgb(), [208, 255, 253]))
    //In between
    t.push(array_equal(get_color_from_kelvin(1700, temp_color_checkpoints).get_rgb(), [253, 126, 1]))
    t.push(array_equal(get_color_from_kelvin(3700, temp_color_checkpoints).get_rgb(), [254, 249, 122]))
    let allTrue = t.every(e => e === true);
    if (allTrue) {
        console.log("All", t.length, "tests of color_scale.js passed!")
    } else {
        for (let i = 0; i < t.length; i++) {
            if (!t[i]) {
                console.log("Test", i + 1, "/", t.length, "of color_scale.js failed")
            }
        }
    }
    return allTrue
}
tests()