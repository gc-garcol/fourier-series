# Fourier Series Drawing

Load a simple image, extract its outline, and redraw it with N Fourier terms (epicycles). N goes from 1 up to the number of sampled points, default 200.

**Live demo:** [https://gc-garcol.github.io/fourier-series/](https://gc-garcol.github.io/fourier-series/)

## Run locally

Open `index.html` in a browser. No build step or server needed.

- `index.html`: page structure
- `index.css`: styles
- `index.js`: image contour extraction, DFT, epicycle animation, and the built-in sample shapes

The app ships with built-in sample shapes (snowflake, which is the default, then heart, star, half moon, balloon, ice cream, apple, cherry, cat, dog, Buddha). Pick one from the "Sample shape" dropdown, or upload, drop or paste (Ctrl/Cmd+V) your own image.

## Math background

A Fourier series represents a complex curve as a sum of simple sine and cosine waves. With enough terms and the right coefficients, it can draw almost any closed curve: a heart, a letter, a logo, or a hand-drawn shape.

### The formula

A point moving in the plane over time $t$ has coordinates:

$$x_N(t)=\sum_{k=1}^{N}(a_k\cos kt+b_k\sin kt)$$

$$y_N(t)=\sum_{k=1}^{N}(c_k\cos kt+d_k\sin kt)$$

- $x(t)$ is the horizontal position and $y(t)$ is the vertical position.
- $N$ is the number of wave components. A larger $N$ can reproduce more complex curves, if the coefficients are chosen well.
- $a_k, b_k, c_k, d_k$ are the coefficients that set the shape of the curve.
- Each $k$ is a different frequency. $k=1$ is the fundamental frequency, and $k=2,3,\ldots$ add finer detail.

To get a different period, replace the angle $kt$ with $\omega kt$, where $\omega$ is the fundamental angular frequency.

### Why summing sines and cosines draws shapes

Start with a circle:

$$x(t)=\cos t,\quad y(t)=\sin t$$

As $t$ runs from $0$ to $2\pi$, the point traces a circle.

| $t$      | $x(t)$ | $y(t)$ | Position     |
| -------- | ------ | ------ | ------------ |
| $0$      | 1      | 0      | Right        |
| $\pi/2$  | 0      | 1      | Top          |
| $\pi$    | -1     | 0      | Left         |
| $3\pi/2$ | 0      | -1     | Bottom       |
| $2\pi$   | 1      | 0      | Back to start |

Adding a wave with a different frequency bends the circle:

$$x(t)=\cos t+0.3\cos 3t,\quad y(t)=\sin t+0.3\sin 3t$$

The frequency-3 term adds bumps and dents. Changing the $0.3$ coefficient, or adding more waves, changes the shape. Each wave is a small motion, and the sum of those motions is the path you see.

### Drawing an arbitrary image

There are two different problems:

**A. You choose the formula.** Pick the coefficients, let $t$ run from $0$ to $2\pi$, compute $x(t)$ and $y(t)$ at each step, and connect the points.

**B. You start from an image.** This is what this project does:

1. Take points along the outline of the image.
2. Write each point as coordinates $x, y$.
3. Use the Discrete Fourier Transform (DFT) to compute the coefficients.
4. Rebuild the outline using a finite number of Fourier terms.

Random coefficients will not draw a chosen shape. The coefficients must be computed from the sample outline.

### Complex form (epicycles)

Treating each point as a complex number $z(t)=x(t)+iy(t)$ turns the problem into a complex Fourier series:

$$z(t)=\sum_{k=-N}^{N}c_k e^{ikt}$$

Each term is a rotating vector (a circle). The tip of the last vector in the chain draws the shape. This is the animation shown in the app.

In `index.js`, the coefficients come from the DFT of the $M$ resampled contour points (details in the sections below). Terms are ordered by frequency $0, +1, -1, +2, -2, \ldots$, and $N$ is the number of terms used.

### From image to complex samples

Before any Fourier math, `index.js` turns the image into $M$ equally spaced points $z_n = x_n + i y_n$ along the outline. Each step has its own bit of math.

1. **Grayscale.** Transparent pixels are composited onto white, then each pixel becomes a weighted sum of its channels (Rec. 601 luma):

   $$g = 0.299R + 0.587G + 0.114B$$

2. **Otsu threshold.** The code builds a 256-bin histogram and picks the threshold $t$ that best separates dark ($\le t$) from light pixels. It maximizes the between-class variance:

   $$\sigma_B^2(t) = w_B(t)\,w_F(t)\,\big[\mu_B(t)-\mu_F(t)\big]^2$$

   $w_B, w_F$ are the pixel counts of the two classes and $\mu_B, \mu_F$ their mean gray levels. Using counts instead of fractions scales the value by a constant, so the best $t$ is the same.

   Polarity (which class is the shape) is decided from the one-pixel ring at the image edge. If most of that ring is dark, the background is dark and the light pixels become the shape.

3. **Largest connected component.** Foreground pixels are grouped with 8-connectivity (a pixel touches its 8 neighbours, including diagonals). Only the biggest group is kept, so specks of noise do not become part of the curve.

4. **Boundary tracing.** Moore-neighbour tracing walks around the outer edge of the shape. At each pixel it scans the 8 neighbours clockwise, starting just after the cell it came from, and steps to the first foreground one. Jacob's stopping criterion ends the walk when it re-enters the start pixel heading to the same first neighbour. The result is an ordered closed loop of pixels, which is exactly what a periodic function $z(t)$ needs.

5. **Arc-length resampling.** The traced pixels are not evenly spaced: a diagonal step is $\sqrt2$ long, a straight step is $1$. The DFT assumes samples at equal time steps, so the loop is resampled so that time is proportional to distance travelled.

   With segment lengths $\ell_i=\lVert p_{i+1}-p_i\rVert$, cumulative length $s_i=\sum_{m<i}\ell_m$, and total length $L$, the $j$-th sample sits at arc length $jL/M$. It is found by linear interpolation inside the segment that contains it:

   $$p = p_i + f\,(p_{i+1}-p_i),\qquad f=\frac{jL/M - s_i}{\ell_i}$$

   $M=\min(1024,\ \text{number of traced pixels})$.

6. **Centre and normalize.** The centroid is subtracted, then all points are divided by the largest half-extent $\max(|x|,|y|)$. The drawing fits in $[-1,1]^2$, whatever the image size. After centring the mean of $z_n$ is $0$, so $c_0$ is close to $0$. It is still applied as a fixed offset.

The image $y$ axis points down. The code keeps that convention on the canvas, so no flip is needed.

### The DFT used in the app

The samples are taken at times $t_n = 2\pi n/M$, for $n=0,\ldots,M-1$. The coefficient for frequency $k$ is the average of the samples, each multiplied by a rotation that cancels frequency $k$:

$$c_k=\frac{1}{M}\sum_{n=0}^{M-1} z_n e^{-i2\pi kn/M}$$

Using Euler's formula $e^{-i\theta}=\cos\theta-i\sin\theta$ and $z_n=x_n+iy_n$, the product expands to real and imaginary parts that the code accumulates directly, with no complex type:

$$(x+iy)(\cos\theta-i\sin\theta)=(x\cos\theta+y\sin\theta)+i\,(y\cos\theta-x\sin\theta)$$

Facts the implementation relies on:

- **Exact at the samples.** The inverse transform $z_n=\sum_{k=0}^{M-1}c_k e^{i2\pi kn/M}$ returns the sampled points exactly. This is why $N=M$ matches the sampled outline.
- **Lookup table.** $e^{i2\pi m/M}$ repeats with period $M$ in $m$, so only $M$ values of $\cos(2\pi j/M)$ and $\sin(2\pi j/M)$ are computed. Each product $kn$ is reduced with $(kn) \bmod M$ to index the table.
- **Cost.** The direct DFT is $O(M^2)$, about $10^6$ multiply-adds for $M=1024$. That is fast enough that no FFT is needed.
- **Negative frequencies.** The DFT only produces $k=0,\ldots,M-1$, but $e^{i2\pi(-j)n/M}=e^{i2\pi(M-j)n/M}$, so frequency $-j$ is the same as index $M-j$: $c_{-j}=c_{M-j}$. For even $M$, $j=M/2$ and $-j$ are the same index, so that term is counted once. That leaves $M-1$ non-DC terms.

### Choosing N (truncation)

The reconstruction keeps $c_0$ and the first $N$ terms in the order $+1,-1,+2,-2,\ldots$:

$$z_N(t)=c_0+\sum_{k\in S_N} c_k e^{ikt},\qquad S_N=\text{first } N \text{ of } \{+1,-1,+2,-2,\ldots\}$$

- Low frequencies carry the overall shape. High frequencies add sharp corners and fine detail, so more terms give a sharper outline.
- The exponentials are orthogonal on the $M$ sample points, so any partial sum with the true coefficients is the least-squares best fit to the samples using those frequencies.
- Terms are ordered by frequency, not by size. Sorting by amplitude $|c_k|$ would also converge quickly, but ordering by frequency makes the effect of $N$ easy to read.
- $c_0$ is always applied and does not count towards $N$. $N=1$ is the single circle $c_1e^{it}$, and $N=M$ behaves like $N=M-1$.
- **Error rate.** The app shows a relative RMS error next to $N$:

  $$\varepsilon(N)=\sqrt{\frac{\sum_{k\notin S_N}|c_k|^2}{\sum_{k\neq 0}|c_k|^2}}$$

  By Parseval's theorem, the energy $\sum_{k\notin S_N}|c_k|^2$ in the omitted terms equals the mean squared distance between the sampled points and the reconstruction. The ratio is shown as a percentage. It is measured on the $M$ resampled points, relative to the non-DC energy of the shape (so the centre $c_0$ is not counted). It falls as $N$ grows and is exactly $0\%$ once all $M-1$ terms are used. The app precomputes the energy of the tail $\sum_{k\notin S_N}|c_k|^2$ once per shape, so each $N$ costs $O(1)$.

### Epicycles: what the circles mean

Write each coefficient in polar form:

$$c_k=r_k e^{i\varphi_k},\qquad r_k=|c_k|=\sqrt{\mathrm{Re}(c_k)^2+\mathrm{Im}(c_k)^2},\qquad \varphi_k=\mathrm{atan2}\big(\mathrm{Im}(c_k),\mathrm{Re}(c_k)\big)$$

Then

$$c_k e^{ikt}=r_k e^{i(kt+\varphi_k)}$$

is a vector of length $r_k$ (the circle radius, `amp` in the code) that starts at angle $\varphi_k$ and spins at $k$ radians per unit of $t$. The sign of $k$ is the direction of rotation. Because the canvas $y$ axis points down, positive frequencies appear to turn clockwise on screen.

Rotating a coefficient by an angle $\theta$ is a complex multiplication, written in real parts as:

$$(a+bi)(\cos\theta+i\sin\theta)=(a\cos\theta-b\sin\theta)+i\,(a\sin\theta+b\cos\theta)$$

The circles are chained tip to tail. With $p_0=c_0$ and $\theta=t$:

$$p_m = p_{m-1} + c_{k_m}e^{ik_m\theta}$$

The centre of circle $m$ is $p_{m-1}$, and its radius is drawn to $p_m$. The last point $p_N$ is the pen tip, and it equals $z_N(\theta)$.

Animation details:

- `progress` runs from $0$ to $1$ over one period (12 seconds at 1x speed), and the angle is $\theta = 2\pi\cdot\text{progress}$.
- The trail is the reconstruction at the sample times $t_s = 2\pi s/M$, up to the current position, ending at the exact tip.
- `rebuildPath` computes those reconstructed samples for the current $N$ in $O(NM)$. For term $k$ it steps the table index by $k \bmod M$ for each sample, so it needs no extra trig calls.
- Circles with a radius under 0.3 px are still summed, but not drawn.

### Minimal canvas example

This samples a Fourier curve and draws it on a `<canvas>`:

```js
const canvas = document.querySelector("canvas");
const ctx = canvas.getContext("2d");

const N = 2000;
const points = [];

for (let i = 0; i <= N; i++) {
  const t = (2 * Math.PI * i) / N;

  const x = Math.cos(t) + 0.3 * Math.cos(3 * t);
  const y = Math.sin(t) + 0.3 * Math.sin(3 * t);

  points.push({
    x: canvas.width / 2 + x * 150,
    y: canvas.height / 2 - y * 150,
  });
}

ctx.beginPath();
points.forEach((p, i) => {
  if (i === 0) ctx.moveTo(p.x, p.y);
  else ctx.lineTo(p.x, p.y);
});
ctx.stroke();
```

Fourier is not an algorithm that understands images. It is a way to represent a curve as a sum of waves. Given a sample shape, you compute the coefficients from it. Given the coefficients, you rebuild the curve by adding the waves back together.
