# Step2urdf

The repository name has been officially changed from `URDFlyS2U` to `step2urdf`. Please use the new name in future references.

**The ultimate tool for converting STEP files to URDF.**

The online version is [https://step2urdf.top](https://step2urdf.top). Try it!

## Privacy & Local Processing
STEP files are processed entirely on your local machine using your own computational resources. No files are uploaded to external servers. Press F12 to open developer tools and verify that all processing happens locally.

## Overview

**Step2urdf** provides a new, user‑friendly way to export CAD (STEP) designs to URDF, making robot model creation faster and more accurate.
It combines precise geometric feature extraction with intuitive configuration and real‑time visualization to ensure an efficient and reliable workflow.

<p align="center">
  <img src='assets/main.png' width="80%" />
</p>

## Key Features

- 🌀 **Precise joint setup from geometry**
  Automatically detects arcs and line segments in the STEP file to define **revolute** and **prismatic** joints accurately.

<p align="center">
  <img src='assets/joint_picking.png' width="60%" />
</p>

- ⚖️ **Automatic inertia and center of mass computation**
  Input the total machine mass — the easiest parameter to measure — and URDFlyS2U automatically calculates the inertia and center of mass for each link.
  Individual link masses can be modified independently.

<p align="center">
  <img src='assets/inertia_computing.png' width="60%" />
</p>

- 🔍 **Interactive joint visualization**
  Visualize joint configurations at any time. Configure and test each joint interactively to ensure correctness before exporting to URDF.

<p align="center">
  <img src='assets/iterative_slide.png' width="60%" />
</p>

- 🔧 **Revolute and prismatic joint support**
  Fully supports both joint types for flexible robot modeling.

- 📊 **Hierarchical model tree viewer**
  Browse and manage all imported solids with an intuitive tree structure. Easily select, hide, or organize components for better workflow control.

<p align="center">
  <img src='assets/solid_visible.png' width="60%" />
</p>


- 🎯 **Fine-tunable axis offset controls**
  Adjust joint axis positions in XYZ directions with precision controls. Fine-tune axis offsets to achieve perfect alignment and accurate joint placement in your robot model.

<p align="center">
  <img src='assets/joint_axis_offset.png' width="60%" />
</p>

## Video Tutorial

[bilibili](https://www.bilibili.com/video/BV168PjzrErB?vd_source=b2a1004302917395bdd25677ed784bdb)

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

## Why Step2urdf

Step2urdf streamlines the process of converting detailed mechanical CAD models into robot description formats, offering precision, convenience, and clarity from design to URDF generation.

## Buy Me a Coffee

Ali Pay

<img src='assets/zfb.png' width="30%" />
  
</p>

WeChat

<img src='assets/wechat.png' width="30%" />
  
## Support

Contact me `yunlongdong@outlook.com`.
