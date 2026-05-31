---
layout: layouts/page.njk
title: Conway's Game of Life on the GPU · danbot lab
description: "My first foray into WebGPU and shaders: an interactive Conway's Game of Life running entirely on your GPU, plus notes on learning the shader programming model."
templateEngineOverride: md
---
<div class="container">
    <div class="content">
      <div id="error_message"></div>
      <canvas></canvas><br>
      <button id="play_simulation_button">play/pause</button><br>
      <label for="tick_rate">Number of milliseconds to wait until simulating the next generation</label><br>
      <input type="range" id="tick_rate" min="10" max="1000" value="20">
      <text id="tick_rate_value">100</text>
      <br>
      <label for="dot_generate">Set the percent chance for a cell to be generated as alive</label><br>
      <button id="reshuffle_button">Regenerate Cells</button>
      <input type="range" id="dot_generate" min="0" max="1" value="0.3" step="0.01">
      <text id="dot_generate_value">100</text>
      <br>
      <p>Zoom in/out in your browser and reload to resize the simulation.</p>
      <script src="tutorial_webgpu.js" type="module"></script>
    </div>
  </div>

# Conway's Game of Life running entirely on your graphics processor
> Written June 2025 but developed June 2024

## The Game of Life
What you see here is a computer simulation of a world with simple rules.
This is a classic introductory computer science project, making it my perfect introduction to shader languages.

Each colored square is _alive_ and can affect the _life_ or _death_ of its neighboring square.

There are 4 rules for this game:
1. Any live square with fewer than two live neighbors dies, as if by underpopulation.
2. Any live square with two or three live neighbors lives on to the next generation.
3. Any live square with more than three live neighbors dies, as if by overpopulation.
4. Any dead square with exactly three live neighbors becomes a live square, as if by reproduction.

There are some special formations that cause interesting results.
To learn more see the [_Conway's Game of Life_ Wikipedia page](https://en.wikipedia.org/wiki/Conway%27s_Game_of_Life)

## Why I made this
After watching some [_Coding Adventures_ by Sebastian Lague](https://youtu.be/Qz0KTGYJtUk?si=tYpJ8wc-RXDjGwWQ), I became very interested in GPU programming.
I have no previous experience with shader languages, but I really wanted to check it out.
Also, I wanted to be able to share my work on this website here in an interactive way. 
Naturally, that led me to figure out something I could have people run in their browsers.
To my knowledge, the only real option for a shader language that the browser supports is WebGL.
However, I wanted to try to understand traditional rendering shaders and compute shaders.
WebGL is planning to have widespread support for computer shaders in WebGL 2.0.
But it's not supported by Google Chrome as of now.
That led me to WebGPU.
I actually really wanted to create my own demo for ray tracing with WebGPU so that people could see it working in real time.
But that was a bit too ambitious for me, so I settled on this instead.
I followed this [tutorial](https://codelabs.developers.google.com/your-first-webgpu-app#2) and then modified it so that you can draw and interact with the simulation.
I hope you enjoy playing around with it.
You kind find a bunch of cool WebGPU demos [here](https://webgpu.github.io/webgpu-samples/?sample=cornell#main.ts).
Maybe someday I'll take the raytracer code from the demo site and allow you to change a bunch of parameters, like number of light bounces and such.

## Sources
* [Conway's Game of Life Wikipedia page](https://en.wikipedia.org/wiki/Conway%27s_Game_of_Life)
* [Tutorial](https://codelabs.developers.google.com/your-first-webgpu-app#2)
* [Coding Adventures with Sebastian Lague](https://youtu.be/Qz0KTGYJtUk?si=tYpJ8wc-RXDjGwWQ)
* [WebGPU sample raytracer](https://webgpu.github.io/webgpu-samples/?sample=cornell#main.ts)
