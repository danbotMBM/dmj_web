# The Perfect Christmas Lights, Overengineered ✨

Modern Christmas lights don't feel as cozy as the lights from the past. When you drive down your local festive street, there is often a distinct lack of warmth that used to be there. It's more heartless, piercing, and robotic. This winter, I was investigating the best Christmas realized this problem and decided to get some of the classic incandescent bulbs with a standard filament. But what is putting me off about these new and improved LED light bulbs, and why aren't they just better?

## Comparing LED to Incandescent
* LED christmas lights
    * Low electricity usage ✅
    * Chain more strands in a row ✅
    * Last longer ✅
    * Harsh colors ❌
    * Robotic twinkling ❌
    * No cozy vibes ❌
* Incandescent
    * Cozy 🎄
    * Warm 🔥
    * Classic 🎅
    * Only 450 bulbs chained together ❌
    * Electric bill ❌

So that is a pretty strong performance from LED lights on all the hard and fast metrics, but at what cost. Is Christmas all about cost savings and practicality. I'd say no, BUT I think LEDs can be better.

For context, here are some examples of each type. Incandescent is on the left, and LED is on the right.

<video id="twinkle-video" autoplay loop muted playsinline>
    <source src="videos/med/incan.mp4" type="video/mp4">
    Your browser does not support the video tag.
</video>
<video id="twinkle-video" autoplay loop muted playsinline>
    <source src="videos/med/led.mp4" type="video/mp4">
    Your browser does not support the video tag.
</video>

There's a magic in those classic lights, and I am determined to try and capture it AND leverage the practical benefits of LED bulbs. I believe there is one major factor to that magical coziness.


## Coziness Comes from _✨Electromagnetic Properties✨_
Notice that the incandescent lights shimmer even if they are not the ones blinking. This is because brightness of the bulbs is related to electrical energy added to the bulb. So, when one bulb flickers off, that electrical energy gets transferred into the all the other bulbs. It is reminiscent of a flickering fire when you look at it reflected against a wall or some other surface.

This transfer of energy does not happen with LED lights. LED's just flicker on and off and don't effect each other at all. This just feels _wrong_.

## The Goal
Capture the magically cozy electromagnetic properties of an incandescent set of Christmas lights by encoding the relationship between the bulbs in the strand in software.

## Basic Circuit Design
I've simplified down the strand of bulbs into a single circuit of bulbs acting as resistors. When a bulb "blinks", the current bypasses the bulb's filament, decreasing the total resistance of the strand. This means that we can use some basic calculations to figure out the amount of energy going into each bulb's filament.

## Complicating factors
During my research, I discovered a bunch of interesting properties that will make the 
1. Temp dependant resistance
2. Energy -> Temp
3. Color shift from red -> orange -> white -> blue as heat increases

The resistance of each bulb does not remain constant, but it increases as the filament heats up. That means that we need to express resistance in the terms of heat. So we can't just do a simple on or off resistor, which makes sense because our goal is a gradual and natural looking state change.

The actual brightness of the glow of the bulb is not correlated with the energy that is being delivered by the wire at that time, but rather on the temperature of the filament which is gradually heated by the energy delivered, and gradually decreased by the radiance and standard convection heat transfer.

When a black body, or rather an imperfect black body, emits radiation it shifts along the electromagnetic spectrum. It starts to overlap with the red side of the visible spectrum and shifts closer to the UV as the heat increases. You actually encounter this all the time when purchasing LED light bulbs. The 2300K light bulbs are meant to recreate the orangish glow of a dim, 2300K incandescent bulb. Don't get me started on how horrible standard 3500K LED bulbs are with their harsh, blue light.

I attempt to model all of this in software, with admittedly variable accuracy.

## Heat -> Resistance
The amount of resistance is modeled by a linear relationship between the temperature and a constant. This constant can be calculated by knowing the shape fo the filament and its material. For my purposes, I've just used a constant.    
```
R = T * c
```

## Energy -> Temp
The temperature of a fillament has 3 main contrubuting factors.
1. Heat delivered by the electrical circuit.
    The heat energy delivered to the filament is determined by the current and the resistance
    ```
    E = I^2 * R
    ```
    So for a period of time (dt)
    ```
    dE = I^2 * R * dt
    ```
2. Heat lost by the actual glowing of the bulb
    This is governed by the Steve Boltzman law. Which says that the energy released by a glowing black body is related to the differece in temperature and 2 constants, the Steve Boltzman constant and the specific emissivity of that material.
    ```
    dE = (T_i^4 - T_0^4) * sbc * specific emissivity
    ```
3. Heat lost to standard convection
    This is a more simple version the Steve Boltzman law that applies to all objects not just radiant bodies. Also, it has a much higher effect than radiance when closer to room temp.
    ```
    dE = (T_i - T_0) * newton cooling constant
    ```

## Color Shift
There is some super interesting math that describes the radiation of a black body given its temperature. However, I'm trying to go from a kelvin temperature directly to a RGB value for the computer display. I decided to take some example colors from certain key temps. I've made a table and just linearly interpolated between all the RGB values.
```
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
```
* [Blackbody Ratiation Interactive Graph](https://space-charts.vercel.app/?temp=3130)
* [Spectral Radiance Desmos](https://www.desmos.com/calculator/xhyts4ee35)


## Limits of the presentation medium
Due to the fact that I am testing this in a graphical representation, I need to somehow map the "percieved brightness" of a bulb in a standard computer display. This took me down an interesting rabbit whole of the world of photometry. I tried to quantize the amount of light in the visible spectrum and correlate that with the radius, or area of the circle that represents the bulb. This was ambitious and ended up being like putting lipstick on a pig. The presentation medium is not close enough to reality to try and correlate them. This lead me to using a tuned arctan scale for the radius of the circle. This seemed reasonable from the intuition I gained from the photometry reading, and it was visibly appealing.