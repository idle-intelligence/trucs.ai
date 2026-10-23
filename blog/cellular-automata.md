---
author: Thomas Cambau
layout: default
title: "Cellular automata in science"
description: "A fluid made of particles on a grid, from the 1986 lattice gas papers to a vortex street computed in a browser tab."
---

# Cellular automata in science

A cellular automaton is a grid of cells, each holding a small state, updated all at once by the same rule applied to every cell and its neighbours. That is the whole definition.

Stanislaw Ulam and John von Neumann came up with the idea at Los Alamos in the 1940s: Ulam was studying crystal growth on a lattice, and von Neumann used a grid of cells to build a machine that could copy itself ([Wikipedia](https://en.wikipedia.org/wiki/Cellular_automaton)). The one most people know is John Conway's Game of Life, which Martin Gardner described in Scientific American in 1970 ([Wikipedia](https://en.wikipedia.org/wiki/Conway%27s_Game_of_Life)). This post is about another use of the idea, as a way of doing physics.

Try the demo: [flow](/flow/)  
Read the code: [github.com/ilnmtlbnm/jacobi2000](https://github.com/ilnmtlbnm/jacobi2000)

## A gas made of bits

In 1973 Jean Hardy, Yves Pomeau and Olivier de Pazzis proposed a fluid made of particles on a square grid. Each particle moves one step per tick along a link, and when two meet head on they collide by a fixed rule. It had one problem: a square grid has too few symmetries, and the flow it produces is not that of an ordinary fluid ([Wikipedia](https://en.wikipedia.org/wiki/Lattice_gas_automaton)).

In 1986 Uriel Frisch, Brosl Hasslacher and Pomeau fixed it by moving to a triangular grid, where each node has six neighbours and the symmetry is hexagonal ([Phys. Rev. Lett. 56, 1505](https://doi.org/10.1103/PhysRevLett.56.1505)). Their lattice gas, FHP, reproduces the equations of fluid flow when you look at it from far enough away.

![A node of the triangular grid with its six links. Before the collision, two particles arrive head on along the east and west links; after it, they leave along the north-east and south-west links.](/blog/images/fhp-cell.svg)

*A node and its six links. Each link holds a particle or does not. Here a head-on pair collides and leaves rotated by 60 degrees (the rotation can go either way). The count of particles and the total momentum are the same before and after.*

A lattice gas is a fluid made of particles that move along the six directions of a triangular grid, one step per tick, and collide at the nodes by a fixed rule. Nothing else is programmed: the flow around an obstacle and the [vortex street](https://en.wikipedia.org/wiki/K%C3%A1rm%C3%A1n_vortex_street) behind it come from those collisions alone.

## The Connection Machine

Each node holds a handful of bits and every node follows the same rule, so a lattice gas fits a machine with a very large number of very small processors. The Connection Machine, built by Danny Hillis's Thinking Machines, was that machine: the CM-2, from 1987, has up to 65,536 one-bit processors ([Wikipedia](https://en.wikipedia.org/wiki/Connection_Machine)). Lattice gases were run on it for real work, for example [Hénon's 1992 implementation of a four-dimensional lattice gas](https://doi.org/10.1007/BF01341753).

![A Connection Machine CM-2 with its rows of red lights.](/blog/images/cm2.webp)

*A Connection Machine CM-2 and its DataVault storage unit, at the Mimms Museum of Technology and Art. Photo: Logg Tandy, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), via [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Connection_Machine_CM-2_and_DataVault_at_The_Mimms_Museum_of_Technology_and_Art.webp) (the background was replaced by a later editor).*

## From bits to averages

A lattice gas is noisy. Every site is either occupied or not, so to see a smooth flow you have to average over many sites and many steps. In the late 1980s the field moved to the lattice Boltzmann method, which keeps the grid and the collision idea but replaces the on-or-off particle by its average, a number ([Wikipedia](https://en.wikipedia.org/wiki/Lattice_Boltzmann_methods); the first such scheme is [McNamara and Zanetti, 1988](https://doi.org/10.1103/PhysRevLett.61.2332)). That removed the noise.

## Back to the particles, in a tab

The flow page goes back to the particles. It is a lattice gas of about 1.5 million nodes, 2048 by 768, running in your browser on the GPU through WebGPU, with a plate in the middle of the channel. On the RTX 3080 I measured it on, it does about five billion node updates per second. When there is no GPU, it falls back to a smaller grid on the processor.

In this ternary version, each link holds −1, 0 or +1 relative to a local reference. That makes the gas less noisy, so it reaches a higher Reynolds number on the same grid.

The core of one step, for the plain binary rule, is a gather and a table lookup. Each node reads one bit from each of its six neighbours, then the 8-bit result indexes a table that holds the collision rule:

```rust
let mut s = self.cells[i] & (REST | OBST);
for d in 0..NDIR {
    s |= self.cells[self.src[i][d] as usize] & (1 << d);
}
// ...
let c = ((chir >> b) & 1) as usize;
let mut post = if wall && s & OBST == 0 { mirror(s) } else { self.table[c][s as usize] };
```

`REST` is a seventh, motionless particle, `OBST` marks the plate, and `c` is a random bit that picks which way a collision rotates.

![The vortex street behind the plate: alternating white and black spots on a grey background.](/blog/images/flow-street.png)

*The page after a couple of minutes. The picture shows how the fluid spins. Black and white are the two directions of rotation on a grey background, and the further from grey, the faster it spins. The plate is at the left, the flow comes from the left, and the spots are the vortices it sheds.*

---

[← blog](/blog/) · [flow](/flow/)
