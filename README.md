# eVTOL Simulation & Visualization Platform

## Overview

This project is a **web-based 3D simulation platform** for visualizing eVTOL (electric Vertical Take-Off and Landing) missions. It renders a dynamic environment with terrain, infrastructure, and mission assets, while replaying trajectory data from a backend service.

The system is designed to support:

* Mission playback
* FPV (First Person View) and chase cameras
* Real-time telemetry visualization
* Future integration with obstacle detection and avoidance systems

---

## Key Features

### 1. 3D Environment (Three.js)
### 2. eVTOL Simulation
### 3. Camera System
### 4. Trajectory System
### 5. Telemetry Output
### 6. Model Handling

## Tech Stack

| Layer        | Technology                   |
| ------------ | ---------------------------- |
| Frontend     | React                        |
| 3D Engine    | Three.js                     |
| Model Format | GLB (GLTF)                   |
| Backend      | Spring Boot (trajectory API) |
| Rendering    | WebGL                        |

---

## Setup Instructions

### 1. Clone Repository

```bash
git clone <your-repo-url>
cd <project-folder>
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Run Frontend

```bash
npm run dev
```

### 4. Start Backend

Ensure backend is running at:

```
http://localhost:8080
```

---

## Controls

| Action      | Description           |
| ----------- | --------------------- |
| Play        | Start simulation      |
| Pause       | Stop simulation       |
| Reset       | Reset mission         |
| Speed       | Adjust playback speed |
| FPV Capture | Save current frame    |

---

## Camera Modes

| Mode     | Behavior               |
| -------- | ---------------------- |
| OVERVIEW | Free orbit             |
| CHASE    | Follows EVTOL          |
| FPV      | Cockpit-mounted camera |

---

## Future Enhancements

* Obstacle detection visualization
* Real-time WebSocket data integration
* Multi-drone simulation
* Physics-based flight model
* Collision avoidance system
* UI overlays (radar, minimap)

---

## Contribution Guidelines

* Keep rendering logic modular
* Avoid blocking operations in animation loop
* Reuse models using cloning
* Maintain consistent coordinate system

---

## Author

@Sreehithaas
@ChandanaSamaleti
@AkshayaGampala
