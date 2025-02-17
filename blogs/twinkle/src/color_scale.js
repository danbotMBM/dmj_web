import {Color} from "./color.js"

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
]);

export function get_color_from_kelvin(kelvin){
    if (typeof(kelvin) != "number"){
        return null
    }

}