---
author: Thomas Cambau
layout: default
title: "Cellular automata in science"
description: "A fluid made of particles on a grid, from the 1986 lattice gas papers to a vortex street computed in a browser tab."
---

# Cellular automata in science

A cellular automaton is a grid of cells, each holding a small state, updated all at once by the same rule applied to every cell and its neighbours.

Stanislaw Ulam and John von Neumann came up with the idea at Los Alamos in the 1940s: Ulam was studying crystal growth on a lattice, and von Neumann used a grid of cells to build a machine that could copy itself. The one most people know is John Conway's Game of Life, which Martin Gardner described in [Scientific American in October 1970](https://doi.org/10.1038/scientificamerican1070-120). In my [llm-life](/llm-life/) demo, a small language model plays Life in your browser, one cell at a time. This post is about another use of the idea, as a way of doing physics, with the same kind of rule on a different grid.

Try the demo: [flow](/flow/)  
Read the code: [github.com/ilnmtlbnm/jacobi2000](https://github.com/ilnmtlbnm/jacobi2000)

## A gas made of bits

In 1973 Jean Hardy, Yves Pomeau and Olivier de Pazzis proposed a fluid made of particles on a square grid ([J. Math. Phys. 14, 1746](https://doi.org/10.1063/1.1666248)). Each particle moves one step per tick along a link, and when two meet head on they collide by a fixed rule. The trouble is the grid: seen from far away, the gas flows differently along the grid lines and along the diagonals, while a real fluid flows the same way in every direction.

Put an obstacle in a stream of fluid and it sheds a street of vortices behind it, turning one way and then the other. Wind blowing clouds past an island shows it from space.

![Clouds streaming past an island, forming a trail of vortices that turn in alternate directions.](/blog/images/juan-fernandez-vortices.jpg)

*A von Kármán vortex street in the clouds downwind of one of the Juan Fernández Islands, off Chile, seen by Landsat 7 on 15 September 1999. The island is at the top left. Image: Robert Cahalan, NASA/GSFC, public domain, [via Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Vortex-street-1.jpg) (rotated and cropped).*

The flow page gets the same street from a very different starting point: a lattice gas, a fluid made of particles that move along the six directions of a triangular grid, one step per tick, and collide at the nodes by a fixed rule. Nothing else is programmed: the flow around an obstacle and the vortex street behind it come from those collisions alone. In 1986 Uriel Frisch, Brosl Hasslacher and Yves Pomeau showed that on a triangular grid, where each node has six neighbours and the symmetry is hexagonal, the flow comes out the same in every direction and follows the equations of fluid flow ([Phys. Rev. Lett. 56, 1505](https://doi.org/10.1103/PhysRevLett.56.1505)). Their model is known as FHP, for Frisch, Hasslacher and Pomeau.

Here is one node of that grid and its six links, with the collision rule at its simplest.

![A node of the triangular grid with its six links. Before the collision, two particles arrive head on along the east and west links; after it, they leave along the north-east and south-west links.](/blog/images/fhp-cell.svg)

*A node and its six links. Each link holds a particle or does not. Here a head-on pair collides and leaves rotated by 60 degrees (the rotation can go either way). The count of particles and the total momentum are the same before and after.*

## The Connection Machine

Each node holds a handful of bits and every node follows the same rule, so a lattice gas fits a machine with a very large number of very small processors. The Connection Machine, built by Danny Hillis's Thinking Machines, was that machine: the CM-2, from 1987, has up to 65,536 one-bit processors ([Hillis, Scientific American, 1987](https://doi.org/10.1038/scientificamerican0687-108)). Lattice gases were run on it for real work, for example [Hénon's 1992 implementation of a four-dimensional lattice gas](https://doi.org/10.1007/BF01341753).

![A Connection Machine CM-2 with its rows of red lights.](/blog/images/cm2.webp)

*A Connection Machine CM-2 and its DataVault storage unit, at the Mimms Museum of Technology and Art. Photo: Logg Tandy, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), via [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Connection_Machine_CM-2_and_DataVault_at_The_Mimms_Museum_of_Technology_and_Art.webp) (the background was replaced by a later editor).*

## From bits to averages

A lattice gas is noisy. Every site is either occupied or not, so to see a smooth flow you have to average over many sites and many steps. In the late 1980s the field moved to the lattice Boltzmann method, which keeps the grid and the collision idea but replaces the on-or-off particle by its average, a number ([McNamara and Zanetti, 1988](https://doi.org/10.1103/PhysRevLett.61.2332)). That removed the noise.

## Back to the particles, in a tab

The flow page goes back to the particles. It is a lattice gas of about 1.6 million nodes, 2048 by 768, running in your browser on the GPU through WebGPU, with a plate in the middle of the channel. On the RTX 3080 I measured it on, it does about five billion node updates per second. When there is no GPU, it falls back to a smaller grid on the processor.

The model on the page is my own variant, signed ternary. Each link holds only the difference from a reference equilibrium set for each block of the grid: −1, 0 or +1. The gas carries less noise, so it reaches a higher Reynolds number on the same grid. Everything is computed in integers, so mass and momentum are conserved exactly and the GPU and the CPU give the same result bit for bit. I found no earlier lattice gas built this way.

The core of one step, for each node, is three moves. Each link takes the value its neighbour had a step ago, corrected for how the local reference differs between the two nodes and rounded at random to a whole number. The value is clamped back to −1, 0 or +1. The six values then index a table that holds the collision rule:

```rust
*dv = self.delta[(c & STATE) as usize][d] as i32;
*rv = p[d].wrapping_sub(pi[d]);
// ...
let k = sround(rp[x], lowbias32(ks ^ i.wrapping_mul(8).wrapping_add(d as u32).wrapping_mul(0x9e37_79b9)));
let v = dlp[x] + k;
let c = v.clamp(-1, 1);
code[x] += (c + 1) as u32 * POW3[d] as u32;
// ...
*o = if own & OBST != 0 { OBST | crate::ternary::bounce(s) } else { self.table.collide(s, rnd, rule) };
```

`delta` is the −1, 0 or +1 value of a link, `p` is the reference at a node, `code` packs the six values into one number in base 3, and `OBST` marks the plate, which bounces particles back.

![The vortex street behind the plate: alternating white and black spots on a grey background.](/blog/images/flow-street.png)

*The page after a couple of minutes. The picture shows how the fluid spins. Black and white are the two directions of rotation on a grey background, and the further from grey, the faster it spins. The plate is at the left, the flow comes from the left, and the spots are the vortices it sheds.*

---

[← blog](/blog/) · [flow](/flow/)
