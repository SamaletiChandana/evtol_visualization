import * as THREE from "three";
import {
  useEffect,
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
let animationId;
const UnifiedVisualizationScene = forwardRef(
  ({ cameraMode = "OVERVIEW", missionMode = true, onPositionUpdate }, ref) => {
    const containerRef = useRef();
    const perspectiveCameraRef = useRef();
    const controlsRef = useRef();
    const rendererRef = useRef();

    const personRef = useRef();
    const evtolRef = useRef();

    const lineGeoRef = useRef();
    const lineRef = useRef(null);
    const trajectoryRef = useRef([]);
    const trajectoryVectorsRef = useRef([]);
    const sceneRef = useRef(null);

    const sim = useRef({
      isRunning: false,
      t: 0,
      index: 0,
      playbackSpeed: 1,
      waitTimer: 0,
      isLanded: false,
      personPicked: false,
      pathCompleted: false,
      returning: false,
    });

    // ===== OFFSETS & COORDINATES =====
    const groundLevel = 0;
    const evtolHeightOffset = 15; // Vertical offset to prevent sinking
    const stationCenter = new THREE.Vector3(-1400, groundLevel, 350);

    const startPos = new THREE.Vector3(
      stationCenter.x - 90,
      evtolHeightOffset,
      stationCenter.z - 90,
    );
    const landingPadPos = new THREE.Vector3(3420, 0, 500);

    const personPos = landingPadPos.clone().add(new THREE.Vector3(-50, 0, -60));

    useImperativeHandle(ref, () => ({
      play: () => (sim.current.isRunning = true),
      pause: () => (sim.current.isRunning = false),
      reset: () => {
        sim.current.isRunning = false;

        sim.current.isLanded = false;
        sim.current.t = 0;
        sim.current.index = 0;
        sim.current.waitTimer = 0;

        sim.current.personPicked = false;
        sim.current.pathCompleted = false;
        if (personRef.current) personRef.current.visible = true;
        if (evtolRef.current) {
          evtolRef.current.position.copy(startPos);
          evtolRef.current.rotation.set(0, 0, 0);
        }
        if (lineGeoRef.current) {
          lineGeoRef.current.setDrawRange(0, 0);
        }
        //  CRITICAL: force telemetry update
        onPositionUpdate?.({
          x: startPos.x,
          y: startPos.y,
          z: startPos.z,
          speed: 0,
          altitude: startPos.y,
          heading: 0,
        });
      },
      setSpeed: (v) => (sim.current.playbackSpeed = v),
      captureFPV: () => {
        const renderer = rendererRef.current;
        if (!renderer) return;

        const link = document.createElement("a");
        link.download = "simulation_view.png";
        link.href = renderer.domElement.toDataURL("image/png");
        link.click();
      },
    }));
    useEffect(() => {
      async function loadTrajectory() {
        try {
          const res = await fetch(
            "http://localhost:8080/api/trajectory?lambda=0.1",
          );

          const data = await res.json();

          const traj = data.trajectory;

          if (!Array.isArray(traj) || traj.length < 2) {
            console.error("Invalid trajectory:", traj);
            return;
          }

          // store raw data
          trajectoryRef.current = traj;

          // ===== CREATE PATH LINE =====
          const points = traj.map((p) => new THREE.Vector3(p.x, p.y + 2, p.z));

          // create smooth curve
          const curve = new THREE.CatmullRomCurve3(points);
          curve.curveType = "catmullrom";
          curve.tension = 0.5;

          // generate smooth points
          const smoothPoints = curve.getPoints(1000);

          // use smooth points for line
          const geometry = new THREE.BufferGeometry().setFromPoints(
            smoothPoints,
          );

          // initially invisible (for animation)
          geometry.setDrawRange(0, 0);
          lineGeoRef.current = geometry;
          const material = new THREE.LineBasicMaterial({
            color: 0x00ff88,
          });
          const line = new THREE.Line(geometry, material);

lineRef.current = line;

// Add only if scene exists
if (sceneRef.current) {
  sceneRef.current.add(line);
}
          // convert to THREE.Vector3
          trajectoryVectorsRef.current = traj.map(
            (p) => new THREE.Vector3(p.x, p.y, p.z),
          );

          console.log(
            "Trajectory loaded:",
            trajectoryVectorsRef.current.length,
          );
        } catch (err) {
          console.error("Fetch failed:", err);
        }
      }

      loadTrajectory();
    }, []);

    useEffect(() => {
      const container = containerRef.current;
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x87ceeb);

      sceneRef.current = scene;
      // 🔥 Reattach trajectory line if already created
if (lineRef.current) {
  scene.add(lineRef.current);
}

      const cameraRig = new THREE.Object3D();
      scene.add(cameraRig);

      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        preserveDrawingBuffer: true,
      });
      renderer.setSize(container.clientWidth, container.clientHeight);
      container.appendChild(renderer.domElement);
      rendererRef.current = renderer;

      const perspectiveCamera = new THREE.PerspectiveCamera(
        60,
        container.clientWidth / container.clientHeight,
        0.1,
        100000,
      );
      perspectiveCamera.updateProjectionMatrix();
      perspectiveCamera.position.set(2200, 1200, 2500);
      perspectiveCameraRef.current = perspectiveCamera;

      cameraRig.add(perspectiveCamera);

      const controls = new OrbitControls(
        perspectiveCamera,
        renderer.domElement,
      );
      controls.enableDamping = true;
      controls.target.set(stationCenter.x, 0, stationCenter.z);
      perspectiveCamera.position.set(
        stationCenter.x + 2000,
        1200,
        stationCenter.z + 2500,
      );
      controls.update();

      controlsRef.current = controls;

      scene.add(new THREE.AmbientLight(0xffffff, 0.25));
      const sun = new THREE.DirectionalLight(0xffffff, 0.9);
      sun.position.set(150, 250, 100);
      sun.castShadow = true;
      scene.add(sun);

      // ======== GROUND SETUP ========

      // 1 Load textures (grass + displacement)
      const textureLoader = new THREE.TextureLoader();

      // Grass color texture
      const grassTexture = textureLoader.load("/textures/grass.jpg");
      grassTexture.wrapS = THREE.RepeatWrapping;
      grassTexture.wrapT = THREE.RepeatWrapping;
      grassTexture.repeat.set(100, 100);
      grassTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      grassTexture.encoding = THREE.sRGBEncoding;

      // Displacement map (grayscale image for bumps)
      // You can create a simple black/white heightmap or generate one
      const displacementTexture = textureLoader.load(
        "/textures/grass_displacement.jpg",
      );
      displacementTexture.wrapS = THREE.RepeatWrapping;
      displacementTexture.wrapT = THREE.RepeatWrapping;
      displacementTexture.repeat.set(100, 100);
      displacementTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();

      // 2️ Create material with displacement
      const groundMat = new THREE.MeshStandardMaterial({
        map: grassTexture,
        displacementMap: displacementTexture,
        displacementScale: 20, // bump height
        roughness: 1,
        metalness: 0,
        color: 0xe6c7a1, // ensures texture color shows
        side: THREE.DoubleSide,
      });
      const hemiLight = new THREE.HemisphereLight(
        0xffffff, // sky color
        0x444444, // ground bounce color
        0.4,
      );
      scene.add(hemiLight);

      // 3️ Create large plane
      const groundSize = 20000;
      const segments = 200; // high segments needed for displacement
      const groundGeo = new THREE.PlaneGeometry(
        groundSize,
        groundSize,
        segments,
        segments,
      );

      // 4️ Create mesh and rotate
      const ground = new THREE.Mesh(groundGeo, groundMat);
      ground.rotation.x = -Math.PI / 2;
      ground.position.set(stationCenter.x, 0, stationCenter.z);
      ground.receiveShadow = true;
      scene.add(ground);

      // 5️ Adjust camera so everything is visible
      perspectiveCamera.position.set(
        stationCenter.x + 2000,
        1200,
        stationCenter.z + 2500,
      );
      perspectiveCamera.updateProjectionMatrix();
      perspectiveCamera.lookAt(stationCenter);
      controlsRef.current.update();

     // ===== MOUNTAINS (GLB MODELS) =====
      const mountainList = [
        // ===== REFERENCE MOUNTAINS (UNCHANGED CORE) =====
        { x: -100, z: 80, scale: 1.6 },
        { x: 250, z: 750, scale: 1.8 },
        { x: -100, z: 1500, scale: 1.5 },

        // ===== LEFT CLUSTER (shifted slightly left) =====
        { x: -450, z: 230, scale: 1.2 },
        { x: -400, z: 450, scale: 0.8 },
        { x: -400, z: 860, scale: 1.4 },

        // ===== RIGHT CLUSTER (shifted slightly right) =====
        { x: 700, z: 120, scale: 1.3 },
        { x: 750, z: 690, scale: 1.6 },
        { x: 650, z: 990, scale: 1.2 },

        // ===== LOWER AREA (behind path but safe) =====
        { x: -500, z: -140, scale: 1.1 },
        { x: 400, z: -100, scale: 1.4 },

        // ===== UPPER AREA (near landing but offset) =====
        { x: -450, z: 1100, scale: 1.3 },
        { x: 500, z: 1200, scale: 1.5 },

        // ===== DEPTH FILL (keeps hilly look) =====
        { x: -100, z: 1000, scale: 1.7 },
      ];
      const mountainLoader = new GLTFLoader();

      mountainLoader.load("/models/mountain.glb", (gltf) => {
        const baseModel = gltf.scene;

        mountainList.forEach((m, index) => {
          const mountain = baseModel.clone(true);

          // SCALE VARIATION (height difference)
          mountain.scale.set(200 * m.scale, 230 * m.scale, 200 * m.scale);

          // CENTER MODEL
          const box = new THREE.Box3().setFromObject(mountain);
          const center = box.getCenter(new THREE.Vector3());
          mountain.position.sub(center);

          //  PLACE ON GROUND
          const size = box.getSize(new THREE.Vector3());
          mountain.position.y += size.y / 2;

          // FINAL POSITION
          mountain.position.x += m.x;
          mountain.position.z += m.z;
          mountain.position.y += groundLevel;
           scene.add(mountain);
        });
      });
      const loader = new GLTFLoader();

      // GROUND STATION (4 PADS)
      const padOffsets = [
        { x: -90, z: -90 },
        { x: 90, z: -90 },
        { x: -90, z: 90 },
        { x: 90, z: 90 },
      ];
      padOffsets.forEach((offset, idx) => {
        const padPos = new THREE.Vector3(
          stationCenter.x + offset.x,
          0,
          stationCenter.z + offset.z,
        );
        const padMesh = new THREE.Mesh(
          new THREE.CylinderGeometry(75, 75, 8, 32),
          new THREE.MeshStandardMaterial({ color: 0x111111 }),
        );
        padMesh.position.copy(padPos).setY(4);
        scene.add(padMesh);

        if (idx !== 0) {
          loader.load("/models/evtol.glb", (gltf) => {
            gltf.scene.scale.set(2.489, 2.489, 2.489);
            gltf.scene.position.copy(padPos).setY(22 + evtolHeightOffset);
            scene.add(gltf.scene);
          });
        }
      });

      // ===== FENCING AROUND GROUND STATION =====
      const gsFenceHeight = 30;
      const gsFenceThickness = 2;
      const gsFenceLength = 500;
      const gsFenceMaterial = new THREE.MeshStandardMaterial({
        color: 0x555555,
      });

      const gsFencePositions = [
        { x: 0, y: gsFenceHeight / 2, z: gsFenceLength / 2 },
        { x: 0, y: gsFenceHeight / 2, z: -gsFenceLength / 2 },
        { x: gsFenceLength / 2, y: gsFenceHeight / 2, z: 0 },
        { x: -gsFenceLength / 2, y: gsFenceHeight / 2, z: 0 },
      ];

      const groundStationArea = new THREE.Group();
      groundStationArea.position.copy(stationCenter);
      scene.add(groundStationArea);

      gsFencePositions.forEach((pos, index) => {
        let geometry;
        if (index < 2)
          geometry = new THREE.BoxGeometry(
            gsFenceLength,
            gsFenceHeight,
            gsFenceThickness,
          );
        else
          geometry = new THREE.BoxGeometry(
            gsFenceThickness,
            gsFenceHeight,
            gsFenceLength,
          );

        const fenceSegment = new THREE.Mesh(geometry, gsFenceMaterial);
        fenceSegment.position.set(pos.x, pos.y, pos.z);
        groundStationArea.add(fenceSegment);
      });

      // TARGET PAD
      const targetPad = new THREE.Mesh(
        new THREE.CylinderGeometry(75, 75, 8, 32),
        new THREE.MeshStandardMaterial({ color: 0xffd700 }),
      );
      targetPad.position.copy(landingPadPos);
      targetPad.position.y = 4;
      scene.add(targetPad);

      // ACTIVE MODELS
      const evtolGroup = new THREE.Group();
      evtolGroup.position.copy(startPos);
      scene.add(evtolGroup);
      evtolRef.current = evtolGroup;
      loader.load("/models/evtol.glb", (gltf) => {
        const model = gltf.scene;
        model.scale.set(2.489, 2.489, 2.489);
        const box = new THREE.Box3().setFromObject(model);
        const minY = box.min.y;
        model.position.y -= minY; // align bottom to ground
        evtolGroup.add(model);
      });

      //Person
      const pGroup = new THREE.Group();
      const targetPosition = landingPadPos.clone();
      targetPad.position.copy(landingPadPos);
      // place person BESIDE target pad
      pGroup.position.set(
        targetPosition.x - 120, // right side of pad
        0,
        targetPosition.z, // same line
      );
      scene.add(pGroup);
      personRef.current = pGroup;
      loader.load("/models/person.glb", (gltf) => {
        gltf.scene.scale.set(50, 50, 50);
        pGroup.add(gltf.scene);
      });

      // ================== MILITARY CAMP (RIGHT SIDE) ==================
      // ================== CAMP GROUP ==================
      const campGroup = new THREE.Group();

      campGroup.position.copy(landingPadPos);
      campGroup.position.x += 100;
      campGroup.position.z += 50;

      scene.add(campGroup);

      // ================== MILTARY TENTS ==================
      loader.load("/models/military_tent.glb", (gltf) => {
        const baseTent = gltf.scene;
        baseTent.scale.set(100, 100, 100);

        const tentPositions = [
          { x: 300, z: -100 }, // right
        ];

        tentPositions.forEach((pos) => {
          const tent = baseTent.clone();
          tent.position.set(pos.x, 0, pos.z);
          campGroup.add(tent);
        });
      });

      // ================== SOLDIERS (LOAD ONCE, CLONE MANY) ==================

      loader.load("/models/guard_soldier.glb", (gltf) => {
        const baseSoldier = gltf.scene;
        const soldierPositions = [
          { x: 1600, z: -300 },
          { x: 1100, z: 300 },
          { x: 1300, z: -500 },
        ];
        soldierPositions.forEach((pos) => {
          const soldier = SkeletonUtils.clone(baseSoldier);
          soldier.scale.set(4, 4, 4);
          soldier.position.set(pos.x, 5, pos.z);
          soldier.rotation.y = Math.PI;
          campGroup.add(soldier);
        });
      });

      // ===== DECORATED HOSPITAL AREA =====
      const hospitalArea = new THREE.Group();
      hospitalArea.position.set(
        stationCenter.x - 900,
        0,
        stationCenter.z + 900,
      );
      hospitalArea.scale.set(1.3, 1.3, 1.3); //  bigger area
      scene.add(hospitalArea);

      // --- Hospital Sign ---
      const sign = new THREE.Mesh(
        new THREE.BoxGeometry(30, 15, 2),
        new THREE.MeshStandardMaterial({ color: 0xff0000 }),
      );
      sign.position.set(-50, 20, 0);
      hospitalArea.add(sign);

      //Hospital
      loader.load("/models/Hospital.glb", (gltf) => {
        const hospital = gltf.scene;

        hospital.scale.set(1.8, 1.8, 1.8); // adjust as needed
        hospital.position.set(-2500, 185, 1000);
        scene.add(hospital); // attach to hospitalArea
      });

      //radio tower
      loader.load("/models/radiotower.glb", (gltf) => {
        const radio = gltf.scene;

        radio.scale.set(150, 150, 150);
        radio.position.set(
          stationCenter.x + 100,
          stationCenter.y + 340,
          stationCenter.z + -300,
        );

        scene.add(radio);
      });

      // ================== AMBULANCE (LOAD ONCE, CLONE MANY) ==================
      loader.load("/models/Ambulance.glb", (gltf) => {
        const baseAmbulance = gltf.scene;

        const ambulancePositions = [
          { x: stationCenter.x - 700, z: stationCenter.z + 600 },
          { x: stationCenter.x - 500, z: stationCenter.z + 900 },
        ];

        ambulancePositions.forEach((pos, index) => {
          let ambulance;

          if (index === 0) {
            ambulance = baseAmbulance; // first one original
          } else {
            ambulance = baseAmbulance.clone(true); // deep clone
          }

          ambulance.scale.set(10, 10, 10);
          ambulance.position.set(pos.x, 0, pos.z);

          scene.add(ambulance);
        });
      });

      // ==========================
      // SEEDED RANDOM (STABLE)
      // ==========================
      function seededRandom(seed) {
        let x = Math.sin(seed * 9999) * 10000;
        return x - Math.floor(x);
      }

      // ==========================
      // BUILDING POSITIONS
      // ==========================
      const buildingPositions = [];

      const groundHalf = 20000 / 2;

      // LEFT SIDE ZONE ONLY (town area)
      const minX = stationCenter.x - groundHalf + 1500;
      const maxX = stationCenter.x - 2000;

      const minZ = stationCenter.z - groundHalf + 1500;
      const maxZ = stationCenter.z + groundHalf - 1500;

      for (let i = 0; i < 12; i++) {
        let x, z;

        do {
          x = THREE.MathUtils.lerp(minX, maxX, seededRandom(i));
          z = THREE.MathUtils.lerp(minZ, maxZ, seededRandom(i + 50));
        } while (
          z > stationCenter.z + 200 &&
          z < stationCenter.z + 500 // avoid EVTOL corridor
        );

        buildingPositions.push({
          x,
          z,
          scale: 120 + seededRandom(i + 100) * 40,
          rotation: seededRandom(i + 200) * Math.PI * 2,
        });
      }

      // ==========================
      // LOAD BUILDINGS
      // ==========================
      loader.load("/models/large_building.glb", (gltf) => {
        const baseModel = gltf.scene;

        buildingPositions.forEach((pos) => {
          const building = baseModel.clone(true);

          building.scale.set(pos.scale * 1.9, pos.scale * 1.9, pos.scale * 1.9);

          const box = new THREE.Box3().setFromObject(building);
          const center = box.getCenter(new THREE.Vector3());
          building.position.sub(center);

          const size = box.getSize(new THREE.Vector3());
          building.position.y += size.y / 2;

          building.position.x += pos.x;
          building.position.z += pos.z;

          building.rotation.y = pos.rotation;

          scene.add(building);
        });
      });

      // ==========================
      // LOAD TREES
      // ==========================
      loader.load("/models/Trees.glb", (gltf) => {
        const treeBase = gltf.scene;

        // CITY AREA (same as buildings)
        const groundHalf = 20000 / 2;

        const minX = stationCenter.x - groundHalf + 1500;
        const maxX = stationCenter.x - 2000;

        const minZ = stationCenter.z - groundHalf + 1500;
        const maxZ = stationCenter.z + groundHalf - 1500;

        const hospitalCenter = hospitalArea.position;
        const hospitalRadius = 800;

        const treeCount = 60; // ONLY FEW TREES

        for (let i = 0; i < treeCount; i++) {
          let x = THREE.MathUtils.lerp(minX, maxX, Math.random());
          let z = THREE.MathUtils.lerp(minZ, maxZ, Math.random());

          // avoid flight path
          if (z > stationCenter.z + 200 && z < stationCenter.z + 500) continue;

          //  avoid hospital
          const distToHospital = Math.sqrt(
            (x - hospitalCenter.x) ** 2 + (z - hospitalCenter.z) ** 2,
          );
          if (distToHospital < hospitalRadius) continue;

          const tree = treeBase.clone(true);

          const scale = 18 + Math.random() * 6; // smaller variation
          tree.scale.set(scale * 2.8, scale * 2.8, scale * 2.8);

          // ground fix
          const box = new THREE.Box3().setFromObject(tree);
          const minY = box.min.y;

          tree.position.set(x, groundLevel - minY, z);
          tree.rotation.y = Math.random() * Math.PI * 2;

          scene.add(tree);
        }
      });

      //Fencing around hospital
      const fenceLoader = new GLTFLoader();

      fenceLoader.load("/models/wooden_fence.glb", (gltf) => {
        const fenceBase = gltf.scene;

        addFenceAroundHospital(fenceBase);
      });

      function addFenceAroundHospital(baseModel) {
        const half = 450; // since fenceLength = 1000
        const spacing = 80; // distance between fence pieces

        const positions = [];

        // FRONT & BACK (X direction)
        for (let x = -half; x <= half; x += spacing) {
          positions.push({ x, z: -half, rot: 0 }); // front
          positions.push({ x, z: half, rot: 0 }); // back
        }

        // LEFT & RIGHT (Z direction)
        for (let z = -half; z <= half; z += spacing) {
          positions.push({ x: -half, z, rot: Math.PI / 2 }); // left
          positions.push({ x: half, z, rot: Math.PI / 2 }); // right
        }

        positions.forEach((p) => {
          const fence = baseModel.clone(true);

          // scale if needed
          fence.scale.set(70, 90, 70);

          // center model
          const box = new THREE.Box3().setFromObject(fence);
          const center = box.getCenter(new THREE.Vector3());
          fence.position.sub(center);

          const size = box.getSize(new THREE.Vector3());
          fence.position.y += size.y / 2;

          // apply rotation
          fence.rotation.y = p.rot;

          // position relative to hospitalArea
          fence.position.set(p.x, 0, p.z);
          hospitalArea.add(fence);
        });
      }

      // ==========================
      // RADIO TOWERS (Q2, Q3, Q4)
      // ==========================

      loader.load("/models/transmission_tower.glb", (gltf) => {
        const baseTower = gltf.scene;
        const groundHalf = 20000 / 2;
        const minX = stationCenter.x - groundHalf + 1000;
        const maxX = stationCenter.x + groundHalf - 1000;
        const minZ = stationCenter.z - groundHalf + 1000;
        const maxZ = stationCenter.z + groundHalf - 1000;
        const towers = [];
        const placed = [];
        const MIN_DISTANCE = 800; //  spacing between towers
        function isFarEnough(x, z) {
          return placed.every((p) => {
            const dx = p.x - x;
            const dz = p.z - z;
            return Math.sqrt(dx * dx + dz * dz) > MIN_DISTANCE;
          });
        }
        function generateTowers(count, quadrantFn, seedOffset) {
          let created = 0;
          let attempts = 0;
          while (created < count && attempts < 50) {
            const seed = seedOffset + attempts;
            const { x, z } = quadrantFn(seed);
            if (isFarEnough(x, z)) {
              towers.push({ x, z });
              placed.push({ x, z });
              created++;
            }
            attempts++;
          }
        }

        // -------- 2nd Quadrant (-x, +z) --------

        generateTowers(
          2,
          (seed) => ({
            x: THREE.MathUtils.lerp(
              minX,
              stationCenter.x - 500,
              seededRandom(seed * 1.3),
            ),
            z: THREE.MathUtils.lerp(
              stationCenter.z + 500,
              maxZ,
              seededRandom(seed * 2.1),
            ),
          }),
          10,
        );

        // -------- 3rd Quadrant (-x, -z) --------

        generateTowers(
          2,
          (seed) => ({
            x: THREE.MathUtils.lerp(
              minX,
              stationCenter.x - 500,
              seededRandom(seed * 1.7),
            ),
            z: THREE.MathUtils.lerp(
              minZ,
              stationCenter.z - 500,
              seededRandom(seed * 2.5),
            ),
          }),
          100,
        );

        // -------- 4th Quadrant (+x, -z) --------
        generateTowers(
          2,
          (seed) => ({
            x: THREE.MathUtils.lerp(
              stationCenter.x + 500,
              maxX,
              seededRandom(seed * 1.9),
            ),
            z: THREE.MathUtils.lerp(
              minZ,
              stationCenter.z - 500,
              seededRandom(seed * 2.7),
            ),
          }),
          200,
        );

        // -------- Place towers --------
        towers.forEach((pos, index) => {
          const tower = baseTower.clone(true);
          const scale = 120 + seededRandom(index + 300) * 50;
          tower.scale.set(scale, scale, scale);
          const box = new THREE.Box3().setFromObject(tower);
          const center = box.getCenter(new THREE.Vector3());
          tower.position.sub(center);
          const minY = box.min.y;
          tower.position.set(pos.x, groundLevel - minY, pos.z);
          tower.rotation.y = seededRandom(index + 400) * Math.PI * 2;
          scene.add(tower);
        });
      });

      // ===== ANIMATION =====

      let lastTime = 0;

      function animate(time) {
        animationId = requestAnimationFrame(animate);

        const delta = lastTime ? (time - lastTime) * 0.001 : 0;
        lastTime = time;

        const evtol = evtolRef.current;
        const camera = perspectiveCameraRef.current;
        const controls = controlsRef.current;

        const traj = trajectoryRef.current;

        if (!traj || traj.length === 0 || !evtol) {
          renderer.render(scene, camera);
          return;
        }

        // ================== PERSON VISIBILITY ==================
        if (personRef.current) {
          personRef.current.visible = !sim.current.personPicked;
        }

        // ================== MAIN SIMULATION ==================
        if (sim.current.isRunning) {
          const idx = Math.floor(sim.current.index);
          const frac = sim.current.index - idx;

          // Get 4 points (for smooth curve)
          const p0 = traj[Math.max(idx - 1, 0)];
          const p1 = traj[idx];
          const p2 = traj[Math.min(idx + 1, traj.length - 1)];
          const p3 = traj[Math.min(idx + 2, traj.length - 1)];

          if (!p1 || !p2) return;

          // ================== CATMULL-ROM INTERPOLATION ==================
          function catmullRom(t, p0, p1, p2, p3) {
            return (
              0.5 *
              (2 * p1 +
                (-p0 + p2) * t +
                (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
                (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t)
            );
          }

          const pos = evtol.position;

          pos.set(
            catmullRom(frac, p0.x, p1.x, p2.x, p3.x),
            catmullRom(frac, p0.y, p1.y, p2.y, p3.y),
            catmullRom(frac, p0.z, p1.z, p2.z, p3.z),
          );

          // ================== SMOOTH TANGENT ==================
          const nextT = Math.min(frac + 0.01, 1);

          const nextPos = new THREE.Vector3(
            catmullRom(nextT, p0.x, p1.x, p2.x, p3.x),
            catmullRom(nextT, p0.y, p1.y, p2.y, p3.y),
            catmullRom(nextT, p0.z, p1.z, p2.z, p3.z),
          );

          const tangent = nextPos.clone().sub(pos).normalize();

          // ================== LANDING LOGIC ==================
          const distToPad = pos.distanceTo(landingPadPos);

          if (distToPad > 200) {
            sim.current.waitTimer = 0;
            sim.current.index += sim.current.playbackSpeed * 100 * delta;
          } else if (distToPad > 20) {
            sim.current.index += sim.current.playbackSpeed * 50 * delta;

            // smooth descent
            pos.y = THREE.MathUtils.lerp(pos.y, 5, 0.05);
          } else {
            pos.y = 4;
            sim.current.waitTimer += delta;

            if (sim.current.waitTimer > 1.5) {
              sim.current.personPicked = true;
            }

            if (sim.current.waitTimer > 2.5) {
              sim.current.index += sim.current.playbackSpeed * 20 * delta;
            }
          }

          sim.current.index = Math.min(sim.current.index, traj.length - 1);

          // ===== DRAW PATH PROGRESS =====
          if (lineGeoRef.current) {
            const totalRawPoints = trajectoryRef.current.length;
            const totalSmoothPoints = 1000;

            const ratio = totalSmoothPoints / totalRawPoints;

            const drawCount = Math.floor(sim.current.index * ratio);
            lineGeoRef.current.setDrawRange(0, drawCount);
          }

          // ================== ROTATION ==================
          if (tangent.lengthSq() > 0.0001) {
            const flatTangent = tangent.clone();
            flatTangent.y = 0;
            flatTangent.normalize();

            const lookTarget = pos.clone().add(flatTangent);

            const dummy = new THREE.Object3D();
            dummy.position.copy(pos);
            dummy.lookAt(lookTarget);

            // slightly faster rotation for smoother turning
            const turnSpeed = 1; // lower = slower turning

            const turnSharpness = Math.abs(tangent.x) + Math.abs(tangent.z);
            const adaptiveSpeed = THREE.MathUtils.clamp(
              turnSharpness,
              0.5,
              1.5,
            );

            const alpha = 1 - Math.exp(-(turnSpeed / adaptiveSpeed) * delta);

            evtol.quaternion.slerp(dummy.quaternion, alpha);
          }

          // ================== TELEMETRY ==================
          onPositionUpdate?.({
            x: pos.x,
            y: pos.y,
            z: pos.z,
            speed: 220,
            altitude: pos.y,
            heading: Math.atan2(tangent.x, tangent.z) * (180 / Math.PI),
          });
        }
        // ================== CAMERA ==================
        if (camera && controls && evtol) {
          const pos = evtol.position;

          if (cameraMode === "CHASE") {
            const back = new THREE.Vector3(0, 0, -1)
              .applyQuaternion(evtol.quaternion)
              .normalize()
              .multiplyScalar(350);

            camera.position.copy(
              pos
                .clone()
                .add(back)
                .add(new THREE.Vector3(0, 190, 0)),
            );

            controls.target.copy(pos);

            controls.enableRotate = false;
            controls.enableZoom = false;
            controls.enablePan = false;
          } else {
            controls.enableRotate = true;
            controls.enableZoom = true;
            controls.enablePan = true;
          }
        }

        controls.update();
        if (lineGeoRef.current && trajectoryRef.current.length > 0) {
  const totalRawPoints = trajectoryRef.current.length;
  const totalSmoothPoints = 1000;
  const ratio = totalSmoothPoints / totalRawPoints;

  const drawCount = Math.floor(sim.current.index * ratio);
  lineGeoRef.current.setDrawRange(0, drawCount);
}
        renderer.render(scene, camera);
      }

      animate();

      return () => {
        cancelAnimationFrame(animationId);

        if (controlsRef.current) controlsRef.current.dispose();
        if (rendererRef.current) rendererRef.current.dispose();

        if (container && renderer.domElement) {
          container.removeChild(renderer.domElement);
        }
      };
    }, [missionMode, cameraMode]);

    return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
  },
);

export default UnifiedVisualizationScene;
