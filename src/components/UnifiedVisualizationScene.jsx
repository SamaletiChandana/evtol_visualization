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
    const fpvRef = useRef();

    const [screenshots, setScreenshots] = useState([]);
    const [selectedImage, setSelectedImage] = useState(null);
    const MAX_HISTORY = 6;
    const [showPanel, setShowPanel] = useState(true);

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
        const image = renderer.domElement.toDataURL("image/png");
        setScreenshots((prev) => {
          const newList = [...prev, image];
          if (newList.length > MAX_HISTORY) {
            newList.shift(); // remove oldest
          }
          return newList;
        });
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
    function horizontalToVerticalFOV(hFOV, aspect) {
      const hFOVRad = THREE.MathUtils.degToRad(hFOV);
      const vFOVRad = 2 * Math.atan(Math.tan(hFOVRad / 2) / aspect);
      return THREE.MathUtils.radToDeg(vFOVRad);
    }

    useEffect(() => {
      const container = containerRef.current;
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x87ceeb);

      sceneRef.current = scene;
      //  Reattach trajectory line if already created
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

      const aspect = container.clientWidth / container.clientHeight;

      const getVerticalFOV = (hFov, aspect) => {
        return (
          2 *
          Math.atan(Math.tan((hFov * Math.PI) / 360) / aspect) *
          (180 / Math.PI)
        );
      };

      // default FOV (will change later dynamically)
      const perspectiveCamera = new THREE.PerspectiveCamera(
        60,
        aspect,
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

      // ===== CUSTOM FOV ZOOM =====
      renderer.domElement.addEventListener("wheel", (e) => {
        if (cameraMode !== "FOV") return;

        e.preventDefault();

        const camera = perspectiveCameraRef.current;

        // adjust sensitivity
        camera.fov += e.deltaY * 0.05;

        // clamp FOV (important)
        camera.fov = THREE.MathUtils.clamp(camera.fov, 20, 100);

        camera.updateProjectionMatrix();
      });

      controls.enableDamping = true;
      controls.target.set(stationCenter.x, 0, stationCenter.z);
      perspectiveCamera.position.set(
        stationCenter.x + 2000,
        1200,
        stationCenter.z + 2500,
      );
      controls.update();

      controlsRef.current = controls;

      scene.add(new THREE.AmbientLight(0xffffff, 0.28));
      const sun = new THREE.DirectionalLight(0xffffff, 1.8);
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

      // =========================
      // LOAD TOWN HOUSE BUILDINGS
      // =========================

      const gltfLoader = new GLTFLoader();

      gltfLoader.load(
        "/models/large_building.glb", // path in public folder
        (gltf) => {
          const baseBuilding = gltf.scene;

          // Optional scaling (adjust if too big/small)
          baseBuilding.scale.set(200, 200, 200);

          // Building placements (facing each other)
          const buildingPositions = [
            {
              x: 1550,
              y: 0,
              z: 300,
              rotationY: Math.PI / 2,
            },
            {
              x: 2350,
              y: 0,
              z: 300,
              rotationY: -Math.PI / 2,
            },
          ];

          buildingPositions.forEach((pos) => {
            // Clone model
            const building = baseBuilding.clone(true);

            // Position
            building.position.set(pos.x, pos.y, pos.z);

            // Rotate so they face each other
            building.rotation.y = pos.rotationY;

            // Optional shadows
            building.traverse((child) => {
              if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
              }
            });

            scene.add(building);
          });
        },
      );

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
          mountain.scale.set(200 * m.scale, 270 * m.scale, 200 * m.scale);

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

      const fpvOffset = new THREE.Object3D();
      fpvOffset.position.set(0, 25, 80);
      // ↑ tweak values:
      // Y = cockpit height
      // Z = front nose
      fpvRef.current = fpvOffset;
      evtolGroup.add(fpvOffset);

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
        gltf.scene.scale.set(60, 60, 60);
        pGroup.add(gltf.scene);
      });

      //FUEL-STATION(LEFT-SIDE)
      let chimney;

      loader.load("/models/Chimney.glb", (gltf) => {
        chimney = gltf.scene;
        chimney.scale.set(2, 1, 2);

        // ===== FIX ALIGNMENT =====
        const box = new THREE.Box3().setFromObject(chimney);
        const center = box.getCenter(new THREE.Vector3());
        chimney.position.sub(center);
        const size = box.getSize(new THREE.Vector3());
        chimney.position.y += size.y / 2;

        // ===== PLACE IN 4TH QUADRANT =====
        chimney.position.x += stationCenter.x + 5000; // +X
        chimney.position.z += stationCenter.z + 6000; // -Z
        scene.add(chimney);

        // ===== SMOKE =====
        const newBox = new THREE.Box3().setFromObject(chimney);
        const top = newBox.max.clone().add(new THREE.Vector3(0, 5, 0));
      });

      const fuelTankLoader = new GLTFLoader();
      fuelTankLoader.load("/models/fuel_tank.glb", (gltf) => {
        const baseTank = gltf.scene;
        // ===== FUEL AREA CONFIG =====
        const fuelGroup = new THREE.Group();
        scene.add(fuelGroup);
        const baseX = 4000; // fixed X (left-right position)
        const baseZ = 8000; // starting Z position
        const spacing = 500; // distance between tanks
        const tankCount = 4;

        for (let i = 0; i < tankCount; i++) {
          const tank = baseTank.clone(true);
          tank.scale.set(250, 250, 250);

          // ===== VERTICAL LINE ARRANGEMENT =====
          const offset = (i - (tankCount - 1) / 2) * spacing;
          tank.position.set(
            baseX, // keep X fixed
            0,
            baseZ + offset, // spread vertically (Z direction)
          );

          // ===== ROTATION =====
          tank.rotation.y = Math.PI / 2;

          // ===== SHADOWS =====
          tank.traverse((child) => {
            if (child.isMesh) {
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });
          fuelGroup.add(tank);
        }
      });

      const truckLoader1 = new GLTFLoader();
      if (!sceneRef.current) return;
      truckLoader1.load("/models/M939_Truck.glb", (gltf) => {
        const baseTruck = gltf.scene;
        const truckGroup = new THREE.Group();
        sceneRef.current.add(truckGroup);

        const fuelCenterX = 6500;
        const fuelCenterZ = 7500;
        const truckCount = 2;

        for (let i = 0; i < truckCount; i++) {
          const truck = SkeletonUtils.clone(baseTruck);
          truck.scale.set(150, 150, 150);
          truck.position.set(
            fuelCenterX - 450 + i * 30,
            0,
            fuelCenterZ + i * 1000,
          );
          truck.rotation.y = 0;
          truck.traverse((child) => {
            if (child.isMesh) {
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });
          truckGroup.add(truck);
        }
      });

      const fenceLoader1 = new GLTFLoader();
      if (!sceneRef.current) return;
      fenceLoader1.load("/models/Fence.glb", (gltf) => {
        const baseFence = gltf.scene;
        const fenceGroup = new THREE.Group();
        sceneRef.current.add(fenceGroup);

        // FUEL STATION CENTER (your values)
        const centerX = 5000;
        const centerZ = 8000;

        // RECTANGLE SIZE (adjust as needed)
        const width = 2000;
        const depth = 1400;
        const spacing = 300; // distance between fence pieces

        // ================= FRONT SIDE =================
        for (let x = -width; x <= width; x += spacing) {
          const fence = SkeletonUtils.clone(baseFence);
          fence.position.set(centerX + x, 0, centerZ + depth);
          fence.rotation.y = 0;
          fence.scale.set(50, 70, 50);
          fenceGroup.add(fence);
        }

        // ================= BACK SIDE =================
        for (let x = -width; x <= width; x += spacing) {
          const fence = SkeletonUtils.clone(baseFence);
          fence.position.set(centerX + x, 0, centerZ - depth);
          fence.rotation.y = 0;
          fence.scale.set(50, 70, 50);
          fenceGroup.add(fence);
        }

        // ================= LEFT SIDE =================
        for (let z = -depth; z <= depth; z += spacing) {
          const fence = SkeletonUtils.clone(baseFence);
          fence.position.set(centerX - width, 0, centerZ + z);
          fence.rotation.y = Math.PI / 2;
          fence.scale.set(50, 70, 50);
          fenceGroup.add(fence);
        }

        // ================= RIGHT SIDE =================
        for (let z = -depth; z <= depth; z += spacing) {
          const fence = SkeletonUtils.clone(baseFence);
          fence.position.set(centerX + width, 0, centerZ + z);
          fence.rotation.y = Math.PI / 2;
          fence.scale.set(50, 70, 50);
          fenceGroup.add(fence);
        }
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
        baseTent.scale.set(120, 150, 170);

        const tentPositions = [
          { x: 80, z: -100 }, // right
        ];

        tentPositions.forEach((pos) => {
          const tent = baseTent.clone();
          tent.position.set(pos.x, 0, pos.z);
          campGroup.add(tent);
        });
      });
      // ================== MILITARY CAMP FENCE ==================
      const fence2Loader = new GLTFLoader();

      fence2Loader.load("/models/Fence.glb", (gltf) => {
        const baseFence = gltf.scene;

        addCampFence(baseFence);
      });
      const tankLoader = new GLTFLoader();

      tankLoader.load("/models/tank.glb", (gltf) => {
        const baseTank = gltf.scene;

        addTanksInsideFence(baseTank);
      });

      function addCampFence(baseModel) {
        const fenceGroup = new THREE.Group();
        campGroup.add(fenceGroup);

        //  RECTANGLE DIMENSIONS
        const halfWidth = 1580; // X (left-right, smaller)
        const frontDepth = 4800; // Z+ (front side → elongated)
        const backDepth = 1500; // Z- (behind tent → shorter)

        const spacing = 300; // distance between fence pieces

        const positions = [];

        // =========================
        // FRONT SIDE (LONG SIDE )
        // =========================
        for (let x = -halfWidth; x <= halfWidth; x += spacing) {
          positions.push({ x: x, z: frontDepth, rot: 0 });
        }

        // =========================
        // BACK SIDE (SHORT SIDE)
        // =========================
        for (let x = -halfWidth; x <= halfWidth; x += spacing) {
          positions.push({ x: x, z: -backDepth, rot: 0 });
        }

        // =========================
        // LEFT SIDE
        // =========================
        for (let z = -backDepth; z <= frontDepth; z += spacing) {
          positions.push({ x: -halfWidth, z: z, rot: Math.PI / 2 });
        }

        // =========================
        // RIGHT SIDE
        // =========================
        for (let z = -backDepth; z <= frontDepth; z += spacing) {
          positions.push({ x: halfWidth, z: z, rot: Math.PI / 2 });
        }

        // =========================
        // PLACE FENCES
        // =========================
        const offsetX = 2990; //  shift right

        positions.forEach((p) => {
          const fence = baseModel.clone(true);

          fence.scale.set(50, 70, 50);

          const box = new THREE.Box3().setFromObject(fence);
          const center = box.getCenter(new THREE.Vector3());
          fence.position.sub(center);

          const size = box.getSize(new THREE.Vector3());
          fence.position.y += size.y / 2;

          fence.rotation.y = p.rot;

          //  APPLY OFFSET HERE
          fence.position.x = p.x + offsetX;
          fence.position.z = p.z;

          fenceGroup.add(fence);
        });
      }

      function addTanksInsideFence(baseModel) {
        const tankGroup = new THREE.Group();
        campGroup.add(tankGroup);

        const offsetX = 3200;

        const tankCount = 4;

        // FORMATION SETTINGS
        const startX = -1200; // starting left
        const startZ = 1300; // starting depth

        const stepX = 100; // small shift → creates slant
        const stepZ = 950; // big forward spacing (vertical feel)

        for (let i = 0; i < tankCount; i++) {
          const tank = baseModel.clone(true);

          // ===== SCALE =====
          tank.scale.set(90.5, 130, 90.5);

          // ===== FORMATION POSITION (SLANTED LINE) =====
          const x = startX + i * stepX; // slight right shift each tank
          const z = startZ + i * stepZ; // forward progression

          // ===== CENTER MODEL =====
          const box = new THREE.Box3().setFromObject(tank);
          const center = box.getCenter(new THREE.Vector3());
          tank.position.sub(center);

          const minY = box.min.y;

          tank.position.set(x + offsetX, groundLevel - minY, z);

          // ===== ALIGN ROTATION=====
          // All tanks face same direction (clean military look)
          tank.rotation.y = Math.PI * 0.75; // adjust if needed

          tankGroup.add(tank);
        }
      }

      //Truck
      const truckLoader = new GLTFLoader();

      truckLoader.load("/models/Truckk.glb", (gltf) => {
        const baseTruck = gltf.scene;

        addTrucksInsideFence(baseTruck);
      });
      function addTrucksInsideFence(baseModel) {
        const truckGroup = new THREE.Group();
        campGroup.add(truckGroup);

        const offsetX = 2990; // same as fence

        // ===== FORMATION SETTINGS (RIGHT SIDE) =====
        const startX = 700; // right side inside fence
        const startZ = 1500; // near mid area

        const stepZ = 900; // spacing between trucks

        const truckCount = 3;

        for (let i = 0; i < truckCount; i++) {
          const truck = baseModel.clone(true);

          // ===== SCALE =====
          truck.scale.set(80, 80, 80);

          // ===== POSITION (VERTICAL PARKING LINE) =====
          const x = startX; // fixed right side
          const z = startZ + i * stepZ; // forward spacing

          // ===== CENTER MODEL =====
          const box = new THREE.Box3().setFromObject(truck);
          const center = box.getCenter(new THREE.Vector3());
          truck.position.sub(center);

          const minY = box.min.y;

          truck.position.set(x + offsetX, groundLevel - minY, z);

          // ===== PARKING ROTATION (SLIGHT ANGLE) =====
          truck.rotation.y = Math.PI * 0.15; // slight angle

          truckGroup.add(truck);
        }
      }
      //Storage boxes
      const crateLoader = new GLTFLoader();

      crateLoader.load("/models/Crate.glb", (gltf) => {
        const baseCrate = gltf.scene;

        addCrates(baseCrate);
      });

      function addCrates(baseModel) {
        const crateGroup = new THREE.Group();
        campGroup.add(crateGroup);

        const offsetX = 2990; // same as fence/tent alignment

        // 👉 BACK OF TENT AREA (negative Z side)
        const baseX = 1000; // near tent center
        const baseZ = -900; // behind tent

        // =========================
        // 🔲 MAIN STACK (2 BOXES)
        // =========================
        for (let i = 0; i < 2; i++) {
          const crate = baseModel.clone(true);

          crate.scale.set(1700, 1700, 1700);

          const box = new THREE.Box3().setFromObject(crate);
          const center = box.getCenter(new THREE.Vector3());
          crate.position.sub(center);

          const size = box.getSize(new THREE.Vector3());
          const minY = box.min.y;

          crate.position.set(
            baseX + offsetX,
            groundLevel - minY + i * size.y, // 🔥 stacking
            baseZ,
          );

          crateGroup.add(crate);
        }

        // =========================
        // 📦 SIDE CRATES (SCATTER)
        // =========================
        const sideOffsets = [
          { x: -70, z: -450 },
          { x: 170, z: -1300 },
          { x: 190, z: -900 },
        ];

        sideOffsets.forEach((pos) => {
          const crate = baseModel.clone(true);

          crate.scale.set(1700, 1700, 1700);

          const box = new THREE.Box3().setFromObject(crate);
          const center = box.getCenter(new THREE.Vector3());
          crate.position.sub(center);

          const minY = box.min.y;

          crate.position.set(
            baseX + pos.x + offsetX,
            groundLevel - minY,
            baseZ + (pos.z - baseZ),
          );

          crate.rotation.y = Math.random() * Math.PI * 2;

          crateGroup.add(crate);
        });
      }

      // ROAD
      const rockLoader = new GLTFLoader();

      rockLoader.load("/models/Rock Path Round Wide.glb", (gltf) => {
        const baseRock = gltf.scene;

        addRockPath(baseRock);
      });

      function addRockPath(baseModel) {
        const rockGroup = new THREE.Group();
        campGroup.add(rockGroup);

        //  PATH SETTINGS
        const pathStartZ = 0; // tent opening (center)
        const pathEndZ = 4800; // till fence front
        const spacing = 180; // distance between rocks

        const pathWidth = 120; // slight width (not a single line)

        for (let z = pathStartZ; z <= pathEndZ; z += spacing) {
          // add 2–3 rocks per row for width
          for (let i = -1; i <= 1; i++) {
            const rock = baseModel.clone(true);

            //  RANDOM WIDTH OFFSET (natural look)
            const offsetX = i * pathWidth + (Math.random() - 0.5) * 40;

            //  SLIGHT FORWARD VARIATION
            const offsetZ = z + (Math.random() - 0.5) * 30;

            // SCALE variation
            const scale = 100 + Math.random() * 30;
            rock.scale.set(scale, scale, scale);

            // CENTER MODEL
            const box = new THREE.Box3().setFromObject(rock);
            const center = box.getCenter(new THREE.Vector3());
            rock.position.sub(center);

            const minY = box.min.y;

            // POSITION (relative to camp)
            const tentOffsetX = 3100;
            const tentOffsetZ = -50;

            rock.position.set(
              offsetX + tentOffsetX,
              groundLevel - minY,
              offsetZ + tentOffsetZ,
            );

            // RANDOM ROTATION
            rock.rotation.y = Math.random() * Math.PI * 2;

            rockGroup.add(rock);
          }
        }
      }
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
          soldier.scale.set(5, 5, 5);
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

        hospital.scale.set(1.8, 2, 1.8); // adjust as needed
        hospital.position.set(-2500, 198, 1000);
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

          ambulance.scale.set(11, 11, 11);
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

      for (let i = 0; i < 40; i++) {
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
      loader.load("/models/Tree.glb", (gltf) => {
        const treeBase = gltf.scene;

        // CITY AREA (same as buildings)
        const groundHalf = 20000 / 2;

        const minX = stationCenter.x - groundHalf + 1500;
        const maxX = stationCenter.x - 2000;

        const minZ = stationCenter.z - groundHalf + 1500;
        const maxZ = stationCenter.z + groundHalf - 1500;

        const hospitalCenter = hospitalArea.position;
        const hospitalRadius = 800;

        const treeCount = 100; // ONLY FEW TREES

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
          tree.scale.set(scale * 2.93, scale * 2.93, scale * 2.93);

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
          fence.scale.set(70, 230, 70);

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
      //Fuel tanks
      const fuelLoader = new GLTFLoader();

      fuelLoader.load("/models/FuelTank.glb", (gltf) => {
        const baseTank = gltf.scene;

        addFuelTanks(baseTank);
      });
      function addFuelTanks(baseModel) {
        const fuelGroup = new THREE.Group();
        scene.add(fuelGroup);

        // ===== POSITION (1st QUADRANT, FAR FROM CAMP) =====
        const baseX = stationCenter.x + 4000; // far right
        const baseZ = stationCenter.z - 9000; // far forward

        const gapX = 300; // spacing between side-by-side tanks
        const gapZ = 800; // spacing between rows

        const positions = [
          // FRONT ROW (facing forward)
          { x: -gapX, z: 0, rot: 0 },
          { x: gapX, z: 0, rot: 0 },

          // BACK ROW (facing opposite)
          { x: -gapX, z: gapZ, rot: Math.PI },
          { x: gapX, z: gapZ, rot: Math.PI },
        ];

        positions.forEach((p) => {
          const tank = baseModel.clone(true);

          // ===== SCALE =====
          tank.scale.set(180, 180, 180);

          // ===== CENTER MODEL =====
          const box = new THREE.Box3().setFromObject(tank);
          const center = box.getCenter(new THREE.Vector3());
          tank.position.sub(center);

          const minY = box.min.y;

          // ===== FINAL POSITION =====
          tank.position.set(baseX + p.x, groundLevel - minY, baseZ + p.z);

          // ===== ROTATION (IMPORTANT) =====
          tank.rotation.y = p.rot;

          fuelGroup.add(tank);
        });
      }
      // ================== FUEL TANK FENCE ==================
      const fuelFenceLoader = new GLTFLoader();

      fuelFenceLoader.load("/models/Fence End.glb", (gltf) => {
        const baseFence = gltf.scene;

        addFuelFence(baseFence);
      });

      function addFuelFence(baseModel) {
        const fenceGroup = new THREE.Group();
        scene.add(fenceGroup);

        // SAME CENTER AS FUEL TANKS
        const baseX = stationCenter.x + 4000;
        const baseZ = stationCenter.z - 7800;

        //  Fence size (adjust if needed)
        const halfWidth = 2800; // X direction
        const halfDepth = 1900; // Z direction

        const spacing = 230;

        const positions = [];

        // ===== FRONT =====
        for (let x = -halfWidth; x <= halfWidth; x += spacing) {
          positions.push({ x, z: halfDepth, rot: 0 });
        }

        // ===== BACK =====
        for (let x = -halfWidth; x <= halfWidth; x += spacing) {
          positions.push({ x, z: -halfDepth, rot: 0 });
        }

        // ===== LEFT =====
        for (let z = -halfDepth; z <= halfDepth; z += spacing) {
          positions.push({ x: -halfWidth, z, rot: Math.PI / 2 });
        }

        // ===== RIGHT =====
        for (let z = -halfDepth; z <= halfDepth; z += spacing) {
          positions.push({ x: halfWidth, z, rot: Math.PI / 2 });
        }

        // ===== PLACE FENCE =====
        positions.forEach((p) => {
          const fence = baseModel.clone(true);

          // scale
          fence.scale.set(180, 550, 180);

          // center fix
          const box = new THREE.Box3().setFromObject(fence);
          const center = box.getCenter(new THREE.Vector3());
          fence.position.sub(center);

          const minY = box.min.y;

          // final position
          fence.position.set(baseX + p.x, groundLevel - minY, baseZ + p.z);

          fence.rotation.y = p.rot;

          fenceGroup.add(fence);
        });
      }

      // ================== FUEL AREA BUILDINGS ==================
      const fuelBuildingLoader = new GLTFLoader();

      fuelBuildingLoader.load("/models/FuelPort.glb", (gltf) => {
        const baseBuilding = gltf.scene;

        addFuelBuildings(baseBuilding);
      });

      function addFuelBuildings(baseModel) {
        const buildingGroup = new THREE.Group();
        scene.add(buildingGroup);

        // SAME CENTER AS FENCE
        const baseX = stationCenter.x + 4300;
        const baseZ = stationCenter.z - 7800;

        const halfWidth = 2800;

        // 👉 LEFT SIDE (inside fence)
        const offsetFromFence = 800; // distance from fence wall

        const positions = [
          { x: -halfWidth + offsetFromFence, z: -500 },
          { x: -halfWidth + offsetFromFence, z: 800 },
        ];

        positions.forEach((p) => {
          const building = baseModel.clone(true);

          // ===== SCALE =====
          building.scale.set(150, 100, 190);

          // ===== CENTER FIX =====
          const box = new THREE.Box3().setFromObject(building);
          const center = box.getCenter(new THREE.Vector3());
          building.position.sub(center);

          const minY = box.min.y;

          // ===== POSITION =====
          building.position.set(baseX + p.x, groundLevel - minY, baseZ + p.z);

          // ===== FACE TOWARDS TANKS (RIGHT SIDE) =====
          building.rotation.y = 0; // facing +X direction

          buildingGroup.add(building);
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
          3,
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
          3,
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

        // -------- Place towers --------
        towers.forEach((pos, index) => {
          const tower = baseTower.clone(true);
          const scale = 150 + seededRandom(index + 300) * 50;
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

          if (cameraMode === "FPV" && fpvRef.current) {
            const worldPos = new THREE.Vector3();
            const worldQuat = new THREE.Quaternion();

            fpvRef.current.getWorldPosition(worldPos);
            fpvRef.current.getWorldQuaternion(worldQuat);

            camera.position.copy(worldPos);
            camera.quaternion.copy(worldQuat);

            // small forward look (stabilizes view)
            const forward = new THREE.Vector3(0, 0, 1)
              .applyQuaternion(worldQuat)
              .multiplyScalar(50);

            controls.target.copy(worldPos.clone().add(forward));

            controls.enableRotate = false;
            controls.enableZoom = false;
            controls.enablePan = false;
          } else if (cameraMode === "CHASE") {
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
          } else if (cameraMode === "FOV" && fpvRef.current) {
            const worldPos = new THREE.Vector3();
            const worldQuat = new THREE.Quaternion();

            fpvRef.current.getWorldPosition(worldPos);
            fpvRef.current.getWorldQuaternion(worldQuat);

            camera.position.copy(worldPos);
            camera.quaternion.copy(worldQuat);

            // small forward look (stabilizes view)
            const forward = new THREE.Vector3(0, 0, 1)
              .applyQuaternion(worldQuat)
              .multiplyScalar(50);

            controls.target.copy(worldPos.clone().add(forward));

            controls.enableRotate = false;
            controls.enableZoom = true;
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

    useEffect(() => {
      if (
        !rendererRef.current ||
        !perspectiveCameraRef.current ||
        !containerRef.current
      )
        return;

      // wait for height transition to finish (VERY IMPORTANT)
      setTimeout(() => {
        const width = containerRef.current.clientWidth;
        const height = containerRef.current.clientHeight;

        rendererRef.current.setSize(width, height);

        perspectiveCameraRef.current.aspect = width / height;
        perspectiveCameraRef.current.updateProjectionMatrix();
      }, 260); // match your CSS transition (0.25s)
    }, [showPanel]);
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          position: "relative",
        }}
      >
        {/* 3D Scene */}
        <div
          ref={containerRef}
          style={{
            width: "100%",
            height: showPanel ? "80%" : "100%", // FIXED LOGIC
            transition: "height 0.25s ease",
          }}
        />

        {/* Screenshot Panel */}
        {showPanel && (
          <div
            style={{
              height: "20%", // EXACT split
              minHeight: "120px", // prevents UI glitch
              background: "#0f172a",
              borderTop: "2px solid #1e293b",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* Header */}
            <div
              style={{
                padding: "4px 10px",
                color: "white",
                fontSize: "13px",
                borderBottom: "1px solid #334155",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span>Screenshot History ({screenshots.length})</span>

              <span
                onClick={() => setShowPanel(false)}
                style={{ cursor: "pointer", fontSize: "16px" }}
              >
                ⬇
              </span>
            </div>

            {/* Images */}
            <div
              style={{
                flex: 1,
                display: "flex",
                gap: "6px",
                padding: "6px",
                overflowX: "auto",
                overflowY: "hidden",
                alignItems: "center",
              }}
            >
              {screenshots.map((img, index) => (
                <img
                  key={index}
                  src={img}
                  alt="screenshot"
                  onClick={() => setSelectedImage(img)}
                  style={{
                    height: "100%",
                    aspectRatio: "16/9",
                    objectFit: "cover",
                    border: "1px solid #555",
                    cursor: "pointer",
                    borderRadius: "4px",
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Floating Up Arrow */}
        {!showPanel && (
          <div
            onClick={() => setShowPanel(true)}
            style={{
              position: "absolute",
              bottom: "10px",
              left: "50%",
              transform: "translateX(-50%)",
              background: "#0f172a",
              color: "white",
              padding: "6px 12px",
              borderRadius: "6px",
              cursor: "pointer",
              border: "1px solid #334155",
              zIndex: 10,
            }}
          >
            ⬆
          </div>
        )}

        {/* FULLSCREEN VIEWER */}
        {selectedImage && (
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              width: "100vw",
              height: "100vh",
              background: "rgba(0,0,0,0.9)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 9999,
            }}
          >
            <div
              onClick={() => setSelectedImage(null)}
              style={{
                position: "absolute",
                top: "20px",
                right: "30px",
                fontSize: "22px",
                color: "red",
                cursor: "pointer",
                fontWeight: "bold",
              }}
            >
              Close
            </div>

            <img
              src={selectedImage}
              alt="full"
              style={{
                maxWidth: "90%",
                maxHeight: "90%",
                border: "3px solid white",
              }}
            />
          </div>
        )}
      </div>
    );
  },
);

export default UnifiedVisualizationScene;
