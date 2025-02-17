import { array_equal } from "./utils.js";

export class Color {
    constructor(color) {
        if (typeof color === "number" && color <= 0xFFFFFF) {
            // hex value
            let rgb = Color.number_to_rgb(color);
            this.red = rgb[0];
            this.green = rgb[1];
            this.blue = rgb[2];
            return this
        } else if (typeof color === "object" && Color.valid_rgb(color)) {
            // rgb value
            this.red = color[0]
            this.green = color[1]
            this.blue = color[2]
            return this
        }
        console.log("ERROR: creating color object: ", color, "is not valid hex or RGB")
        this.red = null;
        this.green = null;
        this.blue = null;
        return null;
    }

    get_rgb() {
        if (this.red == null || this.blue == null || this.green == null) {
            return null
        }
        return [this.red, this.green, this.blue];
    }

    get_hex() {
        return Color.rgb_to_number(this.get_rgb());
    }

    get_css() {
        return `#${(1 << 24 | this.red << 16 | this.green << 8 | this.blue).toString(16).slice(1).toUpperCase()}`;
    }

    static number_to_rgb(number) {
        if (typeof number === "number" && number <= 0xFFFFFF) {
            return [(number >> 16) & 255, (number >> 8) & 255, number & 255]
        }
        console.log("ERROR: rgb number value is invalid:", number);
        return null
    }

    static rgb_to_number(rgb) {
        if (Color.valid_rgb(rgb)) {
            return ((0 << 24) | (rgb[0] << 16) | (rgb[1] << 8) | rgb[2])
        }
        console.log("ERROR: rgb value is invalid:", rgb);
        return null
    }

    static valid_rgb(rgb) {
        return (
            Array.isArray(rgb) &&            // Check if it's an array
            rgb.length === 3 &&              // Ensure it has exactly 3 elements
            rgb.every(num =>                 // Check each number
                Number.isInteger(num) &&        // Must be an integer
                num >= 0 && num <= 255          // Must be in the range [0, 255]
            )
        );
    }

    static get_color_between(before_color, after_color, proportion){
        var red = before_color.red + (after_color.red - before_color.red) * proportion;
        var green = before_color.green + (after_color.green - before_color.green) * proportion;
        var blue = before_color.blue + (after_color.blue - before_color.blue) * proportion;
        return new Color([Math.round(red), Math.round(green), Math.round(blue)])
    }
}

function tests() {
    console.log("Testing color.js ...")
    var t = []
    // Test normal cases
    t.push(array_equal(Color.number_to_rgb(0xFFFFFF), [255, 255, 255]));
    t.push(Color.rgb_to_number([255, 255, 255]) == 0xFFFFFF);
    t.push(new Color([1, 2, 3]).red == 1);
    t.push(new Color([1, 2, 3]).green == 2);
    t.push(new Color([1, 2, 3]).blue == 3);

    // Invalid cases (too few/more than 3 values)
    t.push(Color.rgb_to_number([255, 255]) == null); // Less than 3 values
    t.push(Color.rgb_to_number([255, 255, 0, 0]) == null); // More than 3 values
    t.push(Color.rgb_to_number([255, 255, 256]) == null); // Out of range value (256)
    t.push(Color.rgb_to_number([255, 255, -1]) == null); // Out of range value (-1)

    // Invalid hex value
    t.push(Color.number_to_rgb(0xFFFFFFFFFFF) == null); // Hex too large

    // Test with Color object methods
    t.push(new Color(0xFFFFFF).get_hex() == 0xFFFFFF);
    t.push(array_equal(new Color(0xFFFFFF).get_rgb(), [255, 255, 255]));

    // Check creating Color from RGB array
    t.push((new Color([255, 255, 255])).red == 255); // Correct red value

    // Edge case tests
    t.push(array_equal(Color.number_to_rgb(0x000000), [0, 0, 0])); // Minimum value
    t.push(Color.rgb_to_number([0, 0, 0]) == 0x000000); // Convert [0,0,0] to number

    // Boundary cases (maximum values)
    t.push(Color.rgb_to_number([255, 255, 255]) == 0xFFFFFF); // Max value (255 for each component)

    // Edge case: testing invalid values that can't be parsed
    t.push(Color.rgb_to_number([null, null, null]) == null); // Null values
    t.push(Color.rgb_to_number([undefined, undefined, undefined]) == null); // Undefined values
    t.push(Color.rgb_to_number([255, '255', 255]) == null); // Non-integer string in array

    // Further boundary testing with unusual hex values
    t.push(Color.number_to_rgb(0x100000000) == null); // Larger than 32-bit value

    // Edge test for Color creation from invalid inputs
    t.push(new Color([256, 0, 0]).get_rgb() == null); // Out of range RGB input
    t.push(new Color([-1, 0, 0]).get_hex() == null); // Negative RGB input

    // get_color_between
    t.push(array_equal(Color.get_color_between(new Color([255, 255, 255]), new Color([0,0,0]), 0.5).get_rgb(), [128, 128, 128])); // Out of range RGB input
    t.push(array_equal(Color.get_color_between(new Color([0, 0, 0]), new Color([0,0,0]), 0.5).get_rgb(), [0, 0, 0])); // Out of range RGB input
    t.push(array_equal(Color.get_color_between(new Color([1, 2, 3]), new Color([2,4,6]), 0.5).get_rgb(), [2, 3, 5])); // Out of range RGB input
    t.push(array_equal(Color.get_color_between(new Color([1, 0, 0]), new Color([11,0,0]), 0.1).get_rgb(), [2, 0, 0])); // Out of range RGB input


    let allTrue = t.every(e => e === true);
    if (allTrue) {
        console.log("All", t.length, "tests of color.js passed!")
    } else {
        for (let i = 0; i < t.length; i++) {
            if (!t[i]) {
                console.log("Test", i + 1, "/", t.length, " of color.js failed")
            }
        }
    }
    return allTrue
}

tests()