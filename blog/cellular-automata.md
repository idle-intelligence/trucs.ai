---
author: Thomas Cambau
layout: default
title: "Cellular automata in science"
description: "A fluid made of particles on a grid, from the 1986 lattice gas papers to a vortex street computed in a browser tab."
---

# Cellular automata in science

A cellular automaton is a grid of cells, each holding a small state, updated all at once by the same rule applied to every cell and its neighbours.

Stanislaw Ulam and John von Neumann came up with the idea at Los Alamos in the 1940s: Ulam was studying crystal growth on a lattice, and von Neumann used a grid of cells to build a machine that could copy itself. One of the best-known examples is John Conway's Game of Life, which Martin Gardner described in [Scientific American in October 1970](https://doi.org/10.1038/scientificamerican1070-120). In my [llm-life](/llm-life/) demo, a small language model plays Life in your browser, one cell at a time. This post is about another use of the idea, as a way of doing physics, with the same kind of rule on a different grid.

Try the demo: [flow](/flow/)  
Read the code: [github.com/ilnmtlbnm/jacobi2000](https://github.com/ilnmtlbnm/jacobi2000)

## A gas made of bits

In 1973 Jean Hardy, Yves Pomeau and Olivier de Pazzis proposed a fluid made of particles on a square grid ([J. Math. Phys. 14, 1746](https://doi.org/10.1063/1.1666248)). Each particle moves one step per tick along a link, and when two meet head on they leave at right angles. But on a square grid the gas does not flow like a real fluid: it favours the directions of the grid, and a flow at an angle to them comes out wrong.

Put an obstacle in a stream of fluid and it sheds a street of vortices behind it, turning one way and then the other. A famous and impressive example is wind blowing clouds past an island, where the vortices can be seen from space.

![Clouds streaming past an island, forming a trail of vortices that turn in alternate directions.](/blog/images/juan-fernandez-vortices.jpg)

*A von Kármán vortex street in the clouds downwind of one of the Juan Fernández Islands, off Chile, seen by Landsat 7 on 15 September 1999. The island is at the top left. Image: Robert Cahalan, NASA/GSFC, public domain, [via Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Vortex-street-1.jpg).*

A lattice gas reproduces these vortices from a few simple rules. Its particles move along the six directions of a triangular grid, one step per tick, and collide at the nodes by a fixed rule. Nothing else is programmed: the flow around an obstacle and the vortex street behind it come from those collisions alone. In 1986 Uriel Frisch, Brosl Hasslacher and Yves Pomeau showed that on a triangular grid, where each node has six neighbours, such a gas of on-or-off particles does follow the Navier–Stokes equation, and that it can be used to design simple, massively parallel computing machines ([Phys. Rev. Lett. 56, 1505](https://doi.org/10.1103/PhysRevLett.56.1505)). Their model is known as FHP, for Frisch, Hasslacher and Pomeau.

Here is one node of that grid and its six links, with the collision rule at its simplest.

![A node of the triangular grid with its six links. Before the collision, two particles arrive head on along the east and west links; after it, they leave along the north-east and south-west links.](/blog/images/fhp-cell.svg)

*A node and its six links. Each link holds a particle or does not. Here a head-on pair collides and leaves rotated by 60 degrees (the rotation can go either way). The count of particles and the total momentum are the same before and after.*

## The Connection Machine

Danny Hillis's Thinking Machines built the Connection Machine in the 1980s: a computer of about 64,000 very small processors that all run the same instruction at once. It is a perfect machine for cellular automata, because each processor can take one cell. A node of a lattice gas holds a few bits and follows the same rule as its neighbours.

In [Richard Feynman and the Connection Machine](https://longnow.org/ideas/richard-feynman-and-the-connection-machine/), Hillis tells how Feynman first called the idea of a parallel computer with a million processors "positively the dopiest idea I ever heard", then agreed to spend a summer at the company. The first program run on the machine, in April 1985, was Conway's Life. Later Stephen Wolfram ran a lattice gas of the Frisch, Hasslacher and Pomeau kind on it and made a movie of turbulent flow in two dimensions.

![A Connection Machine CM-2 with its red LED panels lit, next to its DataVault storage unit.](/blog/images/cm2-lit.jpg)

*A Connection Machine CM-2 and its DataVault storage unit. Photo: Logg Tandy, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), [via Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Connection_Machine_CM-2_and_DataVault_at_Computer_Museum_of_America.png) (background removed).*

The machine was then used for real fluid work. Bruce Boghosian, Washington Taylor, Daniel Rothman and Ralph Santos ran a two-colour variant of the triangular-lattice gas on a CM-2, at about 100 million site updates per second ([talk slides](https://people.csail.mit.edu/bradley/cm5docs/Cellular-Automata-Simulation-on-CM-2.pdf)). Chen, Doolen and Eggert ran the standard seven-bit gas in two dimensions, including the [Kelvin-Helmholtz instability](https://doi.org/10.1142/9789814503525_0023). At MIT, the Information Mechanics group built a machine of its own for this kind of simulation, CAM-8, and its [1994 brochure](http://www.ai.mit.edu/projects/im/broch/lat1.html) shows a lattice gas flow in a channel.

## From bits to averages

A lattice gas is noisy. Every site is either occupied or not, so to see a smooth flow you have to average over many sites and many steps. In the late 1980s the field moved to the lattice Boltzmann method, which keeps the grid and the collision idea but replaces the on-or-off particle by its average, a number ([McNamara and Zanetti, 1988](https://doi.org/10.1103/PhysRevLett.61.2332)). That removed the noise.

## Back to the particles, in a tab

The flow page does the opposite. It keeps the particles and averages the picture instead: what it draws is the spin of the fluid, averaged over blocks of sites and over time.

![The vortex street behind the plate: alternating white and black spots on a grey background.](/blog/images/flow-street.png)

*The page after a couple of minutes. The picture shows how the fluid spins. Black and white are the two directions of rotation on a grey background, and the further from grey, the faster it spins. The plate is at the left, the flow comes from the left, and the spots are the vortices it sheds.*

A plate stands in a channel and fluid comes in from the left. After a short while the vortex street forms behind the plate. The grid is about 1.6 million nodes, smaller on a phone. When the browser has WebGPU the simulation runs on the GPU, and otherwise it runs on the processor's threads.

The CM-2 runs above reached about 100 million site updates per second, on a machine of 64,000 processors, nearly forty years ago. On an RTX 3080, a gaming GPU from 2020, the flow page does about 5 billion: some fifty times more, in a browser tab.

The model on the page is my own variant, signed ternary. Each link holds only the difference from a reference equilibrium set for each block of the grid: −1, 0 or +1. The gas carries less noise, so it reaches a higher Reynolds number on the same grid. Everything is computed in integers, so mass and momentum are conserved exactly and the GPU and the CPU give the same result bit for bit. I found no earlier lattice gas built this way.

One step of the update, in pseudo code. The real code is in [the source](https://github.com/ilnmtlbnm/jacobi2000/blob/main/crates/fhp/src/signed/mod.rs).

```
for every node x:
    for each of the six links d:
        v = value of link d at the neighbour it comes from
        v = v + random_round(reference[neighbour][d] - reference[x][d])
        v = clamp(v, -1, +1)
        link[d] = v
    # what rounding and clamping leave over goes to a reservoir
    if x is part of the plate:
        send every particle back where it came from
    else:
        new state = collision_table[link values, random bit]
```

The reference is the local average flow that each value is measured against. A value of −1, 0 or +1 is a small deviation from it.

---

[← blog](/blog/) · [flow](/flow/)
