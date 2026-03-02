# URDFlyS2U

**The ultimate tool for converting STEP files to URDF.**

The website will be online soon.

## Overview

**URDFlyS2U** provides a new, user‑friendly way to export CAD (STEP) designs to URDF, making robot model creation faster and more accurate.
It combines precise geometric feature extraction with intuitive configuration and real‑time visualization to ensure an efficient and reliable workflow.

<p align="center">
  <img src='assets/main.png' width="80%" />
</p>

## Key Features

- 🌀 **Precise joint setup from geometry**
  Automatically detects arcs and line segments in the STEP file to define **revolute** and **prismatic** joints accurately.

<p align="center">
  <img src='assets/joint_picking.png' width="80%" />
</p>

- ⚖️ **Automatic inertia and center of mass computation**
  Input the total machine mass — the easiest parameter to measure — and URDFlyS2U automatically calculates the inertia and center of mass for each link.
  Individual link masses can be modified independently.

<p align="center">
  <img src='assets/inertia_computing.png' width="80%" />
</p>

- 🔍 **Interactive joint visualization**
  Visualize joint configurations at any time. Configure and test each joint interactively to ensure correctness before exporting to URDF.

<p align="center">
  <img src='assets/iterative_slide.png' width="80%" />
</p>

- 🔧 **Revolute and prismatic joint support**
  Fully supports both joint types for flexible robot modeling.

## Usage

### pnpm
#### Install  dependencies

```sh
pnpm install
```

#### Compile and Hot-Reload for Development

```sh
pnpm dev
```

#### Type-Check, Compile and Minify for Production

```sh
pnpm build
```

#### Lint 

```sh
pnpm lint
```
### Using release

Download the release, extract the files, and navigate to the extracted folder. Then run `python -m http.server` and open `127.0.0.1:8000` in your browser.

## Why URDFlyS2U

URDFlyS2U streamlines the process of converting detailed mechanical CAD models into robot description formats, offering precision, convenience, and clarity from design to URDF generation.

## Buy Me a Coffee

Ali Pay

<img src='assets/zfb.png' width="30%" />
  
</p>

WeChat

<img src='assets/wechat.png' width="30%" />
  