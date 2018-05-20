const container = document.getElementById('container');
const canvas = document.getElementById('canvas');

const getQueryVariable = variable => {
  const query = window.location.search.substring(1);
  const vars = query.split('&');
  for (let i = 0; i < vars.length; i++) {
    const pair = vars[i].split('=');
    if (decodeURIComponent(pair[0]) == variable) {
      return decodeURIComponent(pair[1]);
    }
  }
  return null;
};

// const registryUrl = 'http://zeovr.io:9000';
const SIDES = ['left', 'right'];
const RAY_COLOR = 0x44c2ff;
const RAY_HIGHLIGHT_COLOR = new THREE.Color(RAY_COLOR).multiplyScalar(0.5).getHex();
const rayDistance = 10;
const urlBarWidth = 4096;
const urlBarHeight = 256;
const urlBarWorldWidth = 3;
const urlBarWorldHeight = urlBarWorldWidth * urlBarHeight / urlBarWidth;
let currentPortal = -1;
const gridSize = urlBarHeight;
const gridWidth = urlBarWidth;
const gridHeight = gridSize * 8;
const gridWorldWidth = urlBarWorldWidth;
const gridWorldHeight = gridWorldWidth * gridHeight / gridWidth;
const gridWorldSize = gridSize * gridWorldWidth / gridWidth;
const keyboardWidth = 2048;
const keyboardHeight = 716;
const keyboardMatrix = [keyboardWidth / 963.266, keyboardHeight / 337.215];
const SKYBOX_SHADER = {
  uniforms: {
    map: {
      type: 't',
      value: null,
    },
  },
  vertexShader: `\
    uniform sampler2D map;
    varying vec2 vUv;

    void main() {
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      vec4 position2 = projectionMatrix * mvPosition;

      gl_Position = position2;
      vUv = uv;
    }
  `,
  fragmentShader: `\
    uniform sampler2D map;
    varying vec2 vUv;
    float blackLimit = 0.01;

    void main() {
      vec4 color = texture2D(map, vUv);
      float avg = (color.r + color.g + color.b) / 3.0;
      if (avg < blackLimit) {
        float addFactor = blackLimit - avg;
        color.r += addFactor;
        color.g += addFactor;
        color.b += addFactor;
      }
      gl_FragColor = color;
    }
  `,
};

let urlText = 'http://';
let urlCursor = urlText.length;
const urlMeasures = [];
let links = [];
const _getCurrentLinks = () => links.slice(0, 8);

const MESSAGE_TYPES = (() => {
  let id = 0;
  return {
    PLAYER_MATRIX: id++,
    AUDIO: id++,
    OBJECT_MATRIX: id++,
  };
})();

const numPlayerMatrixElements =
  (3+4) + // hmd
  (1 + (3+4)) * 2 + // gamepads
  (1 + (5*4*(3+3))) * 2; // hands
const playerMatrix = (() => {
  const playerMatrix = new ArrayBuffer(Uint32Array.BYTES_PER_ELEMENT*2 + numPlayerMatrixElements*Float32Array.BYTES_PER_ELEMENT);
  playerMatrix.setArrayBuffer = (() => {
    const uint8Array = new Uint8Array(playerMatrix);
    return newArrayBuffer => {
      uint8Array.set(new Uint8Array(newArrayBuffer));
    };
  })();
  let playerMatrixIndex = 0;
  const _getPlayerMatrixIndex = n => {
    const oldPlayerMatrixIndex = playerMatrixIndex;
    playerMatrixIndex += n;
    return oldPlayerMatrixIndex;
  };
  playerMatrix.type = new Uint32Array(playerMatrix, _getPlayerMatrixIndex(Uint32Array.BYTES_PER_ELEMENT), 1);
  playerMatrix.id = new Uint32Array(playerMatrix, _getPlayerMatrixIndex(Uint32Array.BYTES_PER_ELEMENT), 1);
  playerMatrix.hmd = {
    position: new Float32Array(playerMatrix, _getPlayerMatrixIndex(3*Float32Array.BYTES_PER_ELEMENT), 3),
    quaternion: new Float32Array(playerMatrix, _getPlayerMatrixIndex(4*Float32Array.BYTES_PER_ELEMENT), 4),
  };
  const _makePlayerMatrixGamepad = () => {
    const enabled = new Uint32Array(playerMatrix, _getPlayerMatrixIndex(Uint32Array.BYTES_PER_ELEMENT), 1);
    const position = new Float32Array(playerMatrix, _getPlayerMatrixIndex(3*Float32Array.BYTES_PER_ELEMENT), 3);
    const quaternion = new Float32Array(playerMatrix, _getPlayerMatrixIndex(4*Float32Array.BYTES_PER_ELEMENT), 4);

    return {
      enabled,
      position,
      quaternion,
    };
  };
  playerMatrix.gamepads = [
    _makePlayerMatrixGamepad(),
    _makePlayerMatrixGamepad(),
  ];
  const _makePlayerMatrixHand = () => {
    const enabled = new Uint32Array(playerMatrix, _getPlayerMatrixIndex(Uint32Array.BYTES_PER_ELEMENT), 1);
    const data = new Float32Array(playerMatrix, _getPlayerMatrixIndex(5*4*(3+3)*Float32Array.BYTES_PER_ELEMENT), 5*4*(3+3));
    return {
      enabled,
      data,
    };
  };
  playerMatrix.hands = (() => {
    const hands = Array(2);
    for (let i = 0; i < hands.length; i++) {
      hands[i] = _makePlayerMatrixHand();
    }
    return hands;
  })();
  return playerMatrix;
})();
const numObjectMatrixElements = 3+4;
const objectMatrix = (() => {
  const objectMatrix = new ArrayBuffer(Uint32Array.BYTES_PER_ELEMENT*2 + numObjectMatrixElements*Float32Array.BYTES_PER_ELEMENT);
  objectMatrix.setArrayBuffer = (() => {
    const uint8Array = new Uint8Array(objectMatrix);
    return newArrayBuffer => {
      uint8Array.set(new Uint8Array(newArrayBuffer));
    };
  })();
  let objectMatrixIndex = 0;
  const _getObjectMatrixIndex = n => {
    const oldPbjectMatrixIndex = objectMatrixIndex;
    objectMatrixIndex += n;
    return oldPbjectMatrixIndex;
  };
  objectMatrix.type = new Uint32Array(objectMatrix, _getObjectMatrixIndex(Uint32Array.BYTES_PER_ELEMENT), 1);
  objectMatrix.id = new Uint32Array(objectMatrix, _getObjectMatrixIndex(Uint32Array.BYTES_PER_ELEMENT), 1);
  objectMatrix.position = new Float32Array(objectMatrix, _getObjectMatrixIndex(3*Float32Array.BYTES_PER_ELEMENT), 3);
  objectMatrix.quaternion = new Float32Array(objectMatrix, _getObjectMatrixIndex(4*Float32Array.BYTES_PER_ELEMENT), 4);
  return objectMatrix;
})();

const upVector = new THREE.Vector3(0, 1, 0);
const armQuaternionOffset = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, -1));

const localVector = new THREE.Vector3();
const localVector2 = new THREE.Vector3();
const localVector3 = new THREE.Vector3();
const localVector4 = new THREE.Vector3();
const localVector5 = new THREE.Vector3();
const localQuaternion = new THREE.Quaternion();
const localEuler = new THREE.Euler();
localEuler.order = 'YXZ';

const camera = new THREE.PerspectiveCamera(90, window.innerWidth / window.innerHeight, 0.1, 10 * 1024);
camera.position.set(0, 1, 1);
camera.rotation.order = 'YXZ';

const fakeDisplay = window.navigator.createVRDisplay();
fakeDisplay.setSize(window.innerWidth * window.devicePixelRatio, window.innerHeight * window.devicePixelRatio);
fakeDisplay.position.copy(camera.position);
fakeDisplay.quaternion.copy(camera.quaternion);
fakeDisplay.update();
fakeDisplay.requestPresent([{source: canvas}])
  .then(() => {
    renderer.vr.setDevice(fakeDisplay);
  });

const _getGamepads = () => {
  if (fakeDisplay.isPresenting) {
    return fakeDisplay.gamepads;
  } else {
    return navigator.getGamepads();
  }
};

const localPlayerId = Math.floor(Math.random() * 0xFFFFFFFF);
const playerMeshes = [];
const objectMeshes = [];
let voicechatEnabled = false;
let audioCtx = null;
let audioListener = null;
let microphoneMediaStream = null;
const _bindPlayerMeshAudio = playerMesh => {
  const scriptProcessorNode = audioCtx.createScriptProcessor(4096, 1, 1);
  scriptProcessorNode.onaudioprocess = e => {
    if (playerMesh.audioBuffers.length >= 2) {
      e.outputBuffer.copyToChannel(playerMesh.audioBuffers.shift(), 0);
    } else {
      e.outputBuffer.getChannelData(0).fill(0);
    }
  };
  const microphoneSourceNode = audioCtx.createMediaStreamSource(microphoneMediaStream);
  microphoneSourceNode.connect(scriptProcessorNode);

  const positionalAudio = new THREE.PositionalAudio(audioListener);
  positionalAudio.setNodeSource(scriptProcessorNode);
  playerMesh.add(positionalAudio);
};
const ws = (() => {
  const multiplayerServer = getQueryVariable('m');
  if (multiplayerServer) {
    const ws = new WebSocket(multiplayerServer + '?id=' + localPlayerId);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      console.log('websocket open');

      ws.send(JSON.stringify({type: 'playerEnter'}));
    };
    ws.onclose = err => {
      console.log('websocket close');
    };
    ws.onerror = err => {
      console.warn('websocket error', err);
    };
    ws.onmessage = m => {
      const {data} = m;
      if (typeof data === 'string') {
        const j = JSON.parse(data);
        const {type} = j;

        switch (type) {
          case 'playerEnter': {
            const {id} = j;

            const playerMesh = _makeRemotePlayerMesh(id);
            scene.add(playerMesh);
            playerMeshes.push(playerMesh);
            if (audioCtx) {
              _bindPlayerMeshAudio(playerMesh);
            }

            const skinImg = new Image();
            skinImg.crossOrigin = 'Anonymous';
            skinImg.src = 'img/skins/male.png';
            skinImg.onload = () => {
              playerMesh.setImage(skinImg);
            };
            skinImg.onerror = err => {
              console.warn('skin image error', err.stack);
            };

            console.log('player enter', id);
            break;
          }
          case 'playerLeave': {
            const {id} = j;

            const playerMeshIndex = playerMeshes.findIndex(playerMesh => playerMesh.playerId === id);
            const playerMesh = playerMeshes[playerMeshIndex];
            scene.remove(playerMesh);
            playerMeshes.splice(playerMeshIndex, 1);

            console.log('player leave', id);
            break;
          }
          case 'objectAdd': {
            const {id} = j;

            const objectMesh = _makeObjectMesh(id);
            scene.add(objectMesh);
            objectMeshes.push(objectMesh);
            break;
          }
          case 'objectRemove': {
            const {id, owner} = j;

            const objectMeshIndex = objectMeshes.findIndex(objectMesh => objectMesh.objectId === id);
            const objectMesh = objectMeshes[objectMeshIndex];
            scene.remove(objectMesh);
            objectMeshes.splice(objectMeshes, 1);
            break;
          }
          case 'sync': {
            const objectId = 1;
            const objectMesh = objectMeshes.find(objectMesh => objectMesh.objectId === objectId);
            if (!objectMesh) {
              _addObject(objectId);

              ws.send(JSON.stringify({type: 'objectAdd', id: objectId}));
              ws.send(JSON.stringify({type: 'objectSetUpdateExpression', id: objectId, expression: '[1,2,3]'}));
            }
            break;
          }
          default: {
            console.warn('got invalid json messasge type', type);
            break;
          }
        }
      } else {
        const type = new Uint32Array(data, 0, 1)[0];
        if (type === MESSAGE_TYPES.PLAYER_MATRIX) {
          const id = new Uint32Array(data, Uint32Array.BYTES_PER_ELEMENT, 1)[0];
          const playerMesh = playerMeshes.find(playerMesh => playerMesh.playerId === id);

          playerMatrix.setArrayBuffer(data);
          playerMesh.update(playerMatrix);
        } else if (type === MESSAGE_TYPES.AUDIO) {
          if (voicechatEnabled) {
            const id = new Uint32Array(data, Uint32Array.BYTES_PER_ELEMENT, 1)[0];
            const playerMesh = playerMeshes.find(playerMesh => playerMesh.playerId === id);

            const float32Array = new Float32Array(data, Uint32Array.BYTES_PER_ELEMENT*2, (data.byteLength - Uint32Array.BYTES_PER_ELEMENT*2) / Float32Array.BYTES_PER_ELEMENT);
            playerMesh.audioBuffers.push(float32Array);
          }
        } else if (type === MESSAGE_TYPES.OBJECT_MATRIX) {
          const id = new Uint32Array(data, Uint32Array.BYTES_PER_ELEMENT, 1)[0];
          const objectMesh = objectMeshes.find(objectMesh => objectMesh.objectId === id);

          objectMatrix.setArrayBuffer(data);
          objectMesh.update(objectMatrix);
        } else {
          console.warn('unknown binary message type', {type});
        }
      }
    };
    return ws;
  } else {
    return null;
  }
})();
const _isWsOpen = () => !!ws && ws.readyState === WebSocket.OPEN;

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
const renderer = new THREE.WebGLRenderer({
  canvas,
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.sortObjects = false;
renderer.vr.enabled = true;

const _makeRenderTarget = (width, height) => {
  const renderTarget = new THREE.WebGLRenderTarget(width, height);
  renderTarget.depthTexture = new THREE.DepthTexture(
    width,
    height,
    THREE.UnsignedInt248Type,
    THREE.UVMapping,
    THREE.ClampToEdgeWrapping,
    THREE.ClampToEdgeWrapping,
    THREE.NearestFilter,
    THREE.NearestFilter,
    1,
    THREE.DepthStencilFormat
  );
  return renderTarget;
};

let renderTarget = _makeRenderTarget(canvas.width, canvas.height);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xFFFFFF);

const portalMeshes = [];
const frontMeshes = [];
const backMeshes = [];

const ambientLight = new THREE.AmbientLight(0x808080);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xFFFFFF, 1);
directionalLight.position.set(1, 1, 1);
scene.add(directionalLight);

const controllerMeshes = [null, null];
const lastPresseds = [false, false];
const lastMenuPresseds = [false, false];
const lastGrabbeds = [false, false];
const grabbedObjects = [null, null];
for (let i = 0; i < 2; i++) {
  const controllerMesh = new THREE.Object3D();
  controllerMesh.position.set(i === 0 ? -0.1 : 0.1, 1, 0.5);
  controllerMesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(0, -1, -1)
  );

  const rayMesh = (() => {
    const geometry = new THREE.CylinderBufferGeometry(0.001, 0.001, 1, 32, 1)
      .applyMatrix(new THREE.Matrix4().makeRotationX(-Math.PI / 2))
      .applyMatrix(new THREE.Matrix4().makeTranslation(0, 0, -0.5));
    const material = new THREE.MeshBasicMaterial({
      color: RAY_COLOR,
    });

    const mesh = new THREE.Mesh(geometry, material);
    return mesh;
  })();
  controllerMesh.add(rayMesh);
  controllerMesh.rayMesh = rayMesh;

  const rayDot = (() => {
    const geometry = new THREE.SphereBufferGeometry(0.01, 5, 5);
    const material = new THREE.MeshBasicMaterial({
      color: 0xe91e63,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.z = -1;
    return mesh;
  })();
  controllerMesh.add(rayDot);
  controllerMesh.rayDot = rayDot;

  controllerMesh.ray = new THREE.Ray();
  controllerMesh.update = () => {
    controllerMesh.ray.origin.copy(controllerMesh.position);
    controllerMesh.ray.direction
      .set(0, 0, -1)
      .applyQuaternion(controllerMesh.quaternion);
  };

  scene.add(controllerMesh);
  controllerMeshes[i] = controllerMesh;
}

const controllerMeshLoader = new THREE.OBJLoader();
controllerMeshLoader.setPath('models/obj/vive-controller/');
controllerMeshLoader.load('vr_controller_vive_1_5.obj', object => {
  const textureLoader = new THREE.TextureLoader();
  textureLoader.setPath('models/obj/vive-controller/');

  const controllerMesh = object.children[0];
  controllerMesh.material.map = textureLoader.load('onepointfive_texture.png');
  controllerMesh.material.specularMap = textureLoader.load('onepointfive_spec.png');

  controllerMeshes[0].add(object.clone());
  controllerMeshes[1].add(object.clone());
});

const handMeshes = [null, null];
const fingerTipGeometry = new THREE.CylinderBufferGeometry(0.001, 0.001, 1, 32, 1)
  .applyMatrix(new THREE.Matrix4().makeTranslation(0, 1/2, 0));
const boneGeometry = new THREE.CylinderBufferGeometry(0.002, 0.005, 1, 3);
const fingerTipMaterial = new THREE.MeshBasicMaterial({
  color: RAY_COLOR,
});
const boneMaterial = new THREE.MeshPhongMaterial({
  color: 0x00FF00,
});
const _makeHandMesh = () => {
  const handMesh = new THREE.Mesh(fingerTipGeometry, fingerTipMaterial);
  handMesh.visible = false;

  const handFrameData = new Float32Array(new ArrayBuffer(5*4*(3+3) * Float32Array.BYTES_PER_ELEMENT), 0, 5*4*(3+3));
  handMesh.handFrameData = handFrameData;

  const fingerMeshes = Array(5);
  for (let j = 0; j < fingerMeshes.length; j++) {
    const boneMeshes = Array(4);

    for (let k = 0; k < boneMeshes.length; k++) {
      const boneMesh = new THREE.Mesh(boneGeometry, boneMaterial);
      boneMesh.visible = false;
      scene.add(boneMesh);
      boneMeshes[k] = boneMesh;
    }
    fingerMeshes[j] = boneMeshes;
  }

  handMesh.updateFrameData = frameHandData => {
    const palmNormal = localVector.set(frameHandData[3], frameHandData[4], frameHandData[5]);

    if (palmNormal.x !== 0 || palmNormal.y !== 0 || palmNormal.z !== 0) {
      // const palmPosition = localVector.set(frameHandData[0], frameHandData[1], frameHandData[2]);

      const fingerBaseIndex = (1 + (1 * 5)) * (3 + 3);
      const fingerTipPosition = localVector2.set(frameHandData[fingerBaseIndex + 0], frameHandData[fingerBaseIndex + 1], frameHandData[fingerBaseIndex + 2]);
      const fingerTipDirection = localVector3.set(frameHandData[fingerBaseIndex + 3], frameHandData[fingerBaseIndex + 4], frameHandData[fingerBaseIndex + 5]);

      handMesh.position
        .copy(camera.position)
        .add(
          fingerTipPosition.applyQuaternion(camera.quaternion)
        );
      handMesh.quaternion.setFromUnitVectors(
        upVector,
        fingerTipDirection
      ).premultiply(camera.quaternion);
      handMesh.updateMatrixWorld();
      handMesh.visible = true;

      for (let j = 0; j < fingerMeshes.length; j++) {
        const boneMeshes = fingerMeshes[j];

        for (let k = 0; k < boneMeshes.length; k++) {
          const boneMesh = boneMeshes[k];

          const boneBaseIndex = (1 + 1 + (j * 5) + k) * (3 + 3);
          const boneStartPosition = localVector2
            .copy(camera.position)
            .add(
              localVector3
                .set(frameHandData[boneBaseIndex + 0], frameHandData[boneBaseIndex + 1], frameHandData[boneBaseIndex + 2])
                .applyQuaternion(camera.quaternion)
            );
          const boneEndPosition = localVector3
            .copy(camera.position)
            .add(
              localVector4
                .set(frameHandData[boneBaseIndex + 3], frameHandData[boneBaseIndex + 4], frameHandData[boneBaseIndex + 5])
                .applyQuaternion(camera.quaternion)
            );

          const boneCenter = localVector4
            .copy(boneStartPosition)
            .add(boneEndPosition)
            .divideScalar(2);
          const boneDirection = localVector5
            .copy(boneEndPosition)
            .sub(boneStartPosition);
          const boneLength = boneDirection.length();
          boneDirection.divideScalar(boneLength);

          boneMesh.position.copy(boneCenter);
          boneMesh.quaternion.setFromUnitVectors(
            upVector,
            boneDirection
          );
          boneMesh.scale.y = boneLength;
          boneMesh.updateMatrixWorld();
          boneMesh.visible = true;

          boneStartPosition.toArray(handFrameData, j*4*(3+3) + k*(3+3) + 0);
          boneEndPosition.toArray(handFrameData, j*4*(3+3) + k*(3+3) + 3);
        }
      }
    } else {
      handMesh.visible = false;

      for (let j = 0; j < fingerMeshes.length; j++) {
        const boneMeshes = fingerMeshes[j];

        for (let k = 0; k < boneMeshes.length; k++) {
          const boneMesh = boneMeshes[k];
          boneMesh.visible = false;
        }
      }
    }
  };
  handMesh.updatePlayerMatrix = playerMatrixHandData => {
    if (playerMatrixHandData.enabled[0]) {
      for (let j = 0; j < fingerMeshes.length; j++) {
        const boneMeshes = fingerMeshes[j];

        for (let k = 0; k < boneMeshes.length; k++) {
          const boneMesh = boneMeshes[k];

          const boneBaseIndex = ((j*4) + k) * (3+3);
          const boneStartPosition = localVector2.set(playerMatrixHandData.data[boneBaseIndex + 0], playerMatrixHandData.data[boneBaseIndex + 1], playerMatrixHandData.data[boneBaseIndex + 2]);
          const boneEndPosition = localVector3.set(playerMatrixHandData.data[boneBaseIndex + 3], playerMatrixHandData.data[boneBaseIndex + 4], playerMatrixHandData.data[boneBaseIndex + 5]);

          const boneCenter = localVector4
            .copy(boneStartPosition)
            .add(boneEndPosition)
            .divideScalar(2);
          const boneDirection = boneEndPosition
            .sub(boneStartPosition);
          const boneLength = boneDirection.length();
          boneDirection.divideScalar(boneLength);

          boneMesh.position.copy(boneCenter);
          boneMesh.quaternion.setFromUnitVectors(
            upVector,
            boneDirection
          )
          boneMesh.scale.y = boneLength;
          boneMesh.updateMatrixWorld();
          boneMesh.visible = true;
        }
      }
    } else {
      for (let j = 0; j < fingerMeshes.length; j++) {
        const boneMeshes = fingerMeshes[j];

        for (let k = 0; k < boneMeshes.length; k++) {
          const boneMesh = boneMeshes[k];
          boneMesh.visible = false;
        }
      }
    }
  };

  return handMesh;
};
for (let i = 0; i < handMeshes.length; i++) {
  const handMesh = _makeHandMesh();
  scene.add(handMesh);
  handMeshes[i] = handMesh;
}

const _makeRemotePlayerMesh = (() => {
  const hmdQuaternion = new THREE.Quaternion();
  const hmdEuler = new THREE.Euler();
  const controllerPosition = new THREE.Vector3();
  const controllerQuaternion = new THREE.Quaternion();
  const playerEuler = new THREE.Euler();
  const meshWorldPosition = new THREE.Vector3();
  const meshEyeWorldPosition = new THREE.Vector3();
  const playerQuaternionInverse = new THREE.Quaternion();
  const headQuaternion = new THREE.Quaternion();
  const headQuaternionInverse = new THREE.Quaternion();
  const localUpVector = new THREE.Vector3();
  const armWorldPosition = new THREE.Vector3();
  const armQuaternion = new THREE.Quaternion();
  const armQuaternionInverse = new THREE.Quaternion();
  const rotationMatrix = new THREE.Matrix4();

  const _mod = (value, divisor) => {
    const n = value % divisor;
    return n < 0 ? (divisor + n) : n
  };
  const _angleDiff = (a, b) => _mod((b - a) + Math.PI, Math.PI * 2) - Math.PI;

  return playerId => {
    const mesh = skin({
      limbs: true,
    });
    mesh.playerId = playerId;

    const uniforms = THREE.UniformsUtils.clone(skin.SKIN_SHADER.uniforms);

    const handMeshes = Array(2);
    for (let i = 0; i < handMeshes.length; i++) {
      const handMesh = _makeHandMesh();
      scene.add(handMesh);
      handMeshes[i] = handMesh;
    }
    mesh.handMeshes = handMeshes;

    mesh.onBeforeRender = (function(onBeforeRender) {
      return function() {
        mesh.material.uniforms.headRotation.value.copy(uniforms.headRotation.value);
        mesh.material.uniforms.leftArmRotation.value.copy(uniforms.leftArmRotation.value);
        mesh.material.uniforms.rightArmRotation.value.copy(uniforms.rightArmRotation.value);
        mesh.material.uniforms.theta.value = uniforms.theta.value;
        mesh.material.uniforms.headVisible.value = uniforms.headVisible.value;
        mesh.material.uniforms.hit.value = uniforms.hit.value;

        onBeforeRender.apply(this, arguments);
      };
    })(mesh.onBeforeRender);
    mesh.update = playerMatrix => {
      hmdQuaternion.fromArray(playerMatrix.hmd.quaternion);
      hmdEuler.setFromQuaternion(hmdQuaternion, camera.rotation.order);
      playerEuler.setFromQuaternion(mesh.quaternion, camera.rotation.order);
      const angleDiff = _angleDiff(hmdEuler.y, playerEuler.y);
      const angleDiffAbs = Math.abs(angleDiff);
      if (angleDiffAbs > Math.PI / 2) {
        playerEuler.y += (angleDiffAbs - (Math.PI / 2)) * (angleDiff < 0 ? 1 : -1);
        mesh.quaternion.setFromEuler(playerEuler);
      }

      mesh.getWorldPosition(meshWorldPosition);
      mesh.eye.getWorldPosition(meshEyeWorldPosition);
      mesh.position.fromArray(playerMatrix.hmd.position)
        .sub(meshEyeWorldPosition)
        .add(meshWorldPosition);

      playerQuaternionInverse.copy(mesh.quaternion).inverse();
      headQuaternion.copy(playerQuaternionInverse).multiply(hmdQuaternion);
      headQuaternionInverse.copy(headQuaternion).inverse();
      uniforms.headRotation.value.set(headQuaternionInverse.x, headQuaternionInverse.y, headQuaternionInverse.z, headQuaternionInverse.w);
      mesh.head.quaternion.copy(headQuaternion);
      mesh.updateMatrixWorld();

      for (let i = 0; i < SIDES.length; i++) {
        const side = SIDES[i];
        const armRotation = uniforms[side === 'left' ? 'leftArmRotation' : 'rightArmRotation'];

        if (playerMatrix.gamepads[i].enabled[0]) {
          controllerPosition.fromArray(playerMatrix.gamepads[i].position);
          controllerQuaternion.fromArray(playerMatrix.gamepads[i].quaternion);
          localUpVector.copy(upVector).applyQuaternion(controllerQuaternion);

          mesh.arms[side].getWorldPosition(armWorldPosition);
          rotationMatrix.lookAt(
            armWorldPosition,
            controllerPosition,
            localUpVector
          );
          armQuaternion
            .setFromRotationMatrix(rotationMatrix)
            .multiply(armQuaternionOffset)
            .premultiply(playerQuaternionInverse);
          armQuaternionInverse.copy(armQuaternion).inverse();
          armRotation.value.set(armQuaternionInverse.x, armQuaternionInverse.y, armQuaternionInverse.z, armQuaternionInverse.w);
        } else {
          armRotation.value.set(0, 0, 0, 1);
        }
      }

      for (let i = 0; i < handMeshes.length; i++) {
        handMeshes[i].updatePlayerMatrix(playerMatrix.hands[i]);
      }
    };

    mesh.positionalAudio = null;
    mesh.audioBuffers = [];

    return mesh;
  };
})();
const _makeObjectMesh = objectId => {
  const geometry = new THREE.BoxBufferGeometry(0.1, 0.1, 0.1);
  const material = new THREE.MeshPhongMaterial({
    color: 0xFF0000,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.objectId = objectId;
  mesh.update = objectMatrix => {
    mesh.position.fromArray(objectMatrix.position);
    mesh.quaternion.fromArray(objectMatrix.quaternion);

    mesh.updateMatrixWorld();
  };
  return mesh;
};
const _addObject = objectId => {
  const objectMesh = _makeObjectMesh(objectId);
  scene.add(objectMesh);
  objectMeshes.push(objectMesh);
};

const portalGeometry = new THREE.PlaneBufferGeometry(gridWorldSize, gridWorldSize);
const portalBackGeometry = portalGeometry.clone()
  .applyMatrix(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1))));
const skyboxGeometry = new THREE.BoxBufferGeometry(100, 100, 100);

(() => {
  const currentLinks = _getCurrentLinks();
  for (let i = 0; i < currentLinks.length; i++) {
    const y = i;
    const coords = {y};

    const frontMesh = (() => {
      const geometry = portalGeometry;
      const texture = new THREE.Texture(
        null,
        THREE.UVMapping,
        THREE.ClampToEdgeWrapping,
        THREE.ClampToEdgeWrapping,
        THREE.LinearFilter,
        THREE.LinearFilter,
        THREE.RGBAFormat,
        THREE.UnsignedByteType,
        1
      );
      const material = new THREE.MeshBasicMaterial({
        map: texture,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.coords = coords;

      const _updateTab = () => {
        const img = new Image();
        img.src = `img/skybox/cube-5.png`;
        img.onload = () => {
          if (texture.image === null || texture.image.tagName === 'IMG') {
            texture.image = img;
            texture.needsUpdate = true;
          }
        };
        img.error = err => {
          console.warn(err.stack);
        };
      };
      _updateTab();
      mesh.updateTab = _updateTab;

      return mesh;
    })();
    scene.add(frontMesh);
    portalMeshes.push(frontMesh);
    frontMeshes.push(frontMesh);

    const backMesh = (() => {
      const geometry = portalBackGeometry;
      const material = new THREE.MeshBasicMaterial({
        color: 0x111111,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.coords = coords;
      return mesh;
    })();
    scene.add(backMesh);
    portalMeshes.push(backMesh);
    backMeshes.push(backMesh);
  }
})();

function concatBufferGeometry(geometries) {
  geometries = geometries.map(geometry => unindexBufferGeometry(geometry));

  const positions = (() => {
    const geometryPositions = geometries.map(geometry => geometry.getAttribute('position').array);
    const numPositions = sum(geometryPositions.map(geometryPosition => geometryPosition.length));

    const result = new Float32Array(numPositions);
    let i = 0;
    geometryPositions.forEach(geometryPosition => {
      result.set(geometryPosition, i);
      i += geometryPosition.length;
    });
    return result;
  })();
  const normals = (() => {
    const geometryNormals = geometries.map(geometry => geometry.getAttribute('normal').array);
    const numNormals = sum(geometryNormals.map(geometryNormal => geometryNormal.length));

    const result = new Float32Array(numNormals);
    let i = 0;
    geometryNormals.forEach(geometryNormal => {
      result.set(geometryNormal, i);
      i += geometryNormal.length;
    });
    return result;
  })();
  const uvs = (() => {
    const geometryUvs = geometries.map(geometry => geometry.getAttribute('uv').array);
    const numUvs = sum(geometryUvs.map(geometryUv => geometryUv.length));

    const result = new Float32Array(numUvs);
    let i = 0;
    geometryUvs.forEach(geometryUv => {
      result.set(geometryUv, i);
      i += geometryUv.length;
    });
    return result;
  })();

  const geometry = new THREE.BufferGeometry();
  geometry.addAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.addAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.addAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  return geometry;
}
function unindexBufferGeometry(geometry) {
  if (geometry.index) {
    const indexes = geometry.index.array;
    const numIndexes = indexes.length;
    const positionAttribute = geometry.getAttribute('position');
    const oldPositions = positionAttribute ? positionAttribute.array : null;
    const positions = positionAttribute ? new Float32Array(numIndexes * 3) : null;
    const normalAttribute = geometry.getAttribute('normal');
    const oldNormals = normalAttribute ? normalAttribute.array : null;
    const normals = normalAttribute ? new Float32Array(numIndexes * 3) : null;
    const colorAttribute = geometry.getAttribute('color');
    const oldColors = colorAttribute ? colorAttribute.array : null;
    const colors = colorAttribute ? new Float32Array(numIndexes * 3) : null;
    const uvAttribute = geometry.getAttribute('uv');
    const oldUvs = uvAttribute ? uvAttribute.array : null;
    const uvs = uvAttribute ? new Float32Array(numIndexes * 2) : null;
    for (let i = 0; i < numIndexes; i++) {
      const index = indexes[i];

      if (positions !== null) {
        positions[(i * 3) + 0] = oldPositions[(index * 3) + 0];
        positions[(i * 3) + 1] = oldPositions[(index * 3) + 1];
        positions[(i * 3) + 2] = oldPositions[(index * 3) + 2];
      }
      if (normals !== null) {
        normals[(i * 3) + 0] = oldNormals[(index * 3) + 0];
        normals[(i * 3) + 1] = oldNormals[(index * 3) + 1];
        normals[(i * 3) + 2] = oldNormals[(index * 3) + 2];
      }
      if (colors !== null) {
        colors[(i * 3) + 0] = oldColors[(index * 3) + 0];
        colors[(i * 3) + 1] = oldColors[(index * 3) + 1];
        colors[(i * 3) + 2] = oldColors[(index * 3) + 2];
      }
      if (uvs !== null) {
        uvs[(i * 2) + 0] = oldUvs[(index * 2) + 0];
        uvs[(i * 2) + 1] = oldUvs[(index * 2) + 1];
      }
    }
    if (positions !== null) {
      geometry.addAttribute('position', new THREE.BufferAttribute(positions, 3));
    }
    if (normals !== null) {
      geometry.addAttribute('normal', new THREE.BufferAttribute(normals, 3));
    }
    if (colors !== null) {
      geometry.addAttribute('color', new THREE.BufferAttribute(colors, 3));
    }
    if (uvs !== null) {
      geometry.addAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    }
    geometry.index = null;
  }

  return geometry;
}
function sum(a) {
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result += a[i];
  }
  return result;
}

const menuMesh = (() => {
  const object = new THREE.Object3D();
  object.position.copy(camera.position).add(new THREE.Vector3(0, 0.5, -2));

  const urlMesh = (() => {
    const canvas = document.createElement('canvas');
    canvas.width = urlBarWidth;
    canvas.height = urlBarHeight;
    const ctx = canvas.getContext('2d');

    const geometry = new THREE.PlaneBufferGeometry(urlBarWorldWidth, urlBarWorldHeight);
    const texture = new THREE.Texture(
      canvas,
      THREE.UVMapping,
      THREE.ClampToEdgeWrapping,
      THREE.ClampToEdgeWrapping,
      THREE.NearestFilter,
      THREE.NearestFilter,
      // THREE.LinearMipMapLinearFilter,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
      1
    );
    texture.needsUpdate = true;
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);

    const _updateText = () => {
      ctx.clearRect(0, 0, urlBarWidth, urlBarHeight);

      ctx.fillStyle = '#333';
      ctx.fillRect(0, 0, urlBarWidth, urlBarHeight);
      ctx.fillStyle = '#FFF';
      ctx.fillRect(10, 10, urlBarWidth - 10*2, urlBarHeight - 10*2);
      ctx.fillStyle = '#333';
      ctx.font = `${urlBarHeight - 20}px Arial`;
      ctx.fillText(urlText, 10, urlBarHeight - 10);

      urlMeasures.length = 0;
      urlMeasures.push(0);
      const {width: barWidth} = ctx.measureText('[');
      for (let i = 1; i <= urlText.length; i++) {
        const {width} = ctx.measureText('[' + urlText.slice(0, i) + ']');
        urlMeasures.push(width - barWidth*2);
      }

      ctx.fillStyle = '#03a9f4';
      const cursorWidth = 20;
      ctx.fillRect(10 + urlMeasures[urlCursor] - cursorWidth/2, 20, cursorWidth, urlBarHeight - 20*2);

      texture.needsUpdate = true;
    };
    _updateText();
    mesh.updateText = _updateText;

    mesh.plane = new THREE.Plane();
    mesh.leftLine = new THREE.Line3();
    mesh.topLine = new THREE.Line3();
    mesh.update = () => {
      mesh.leftLine.start
        .set(-urlBarWorldWidth/2, urlBarWorldHeight/2, 0)
        .applyMatrix4(mesh.matrixWorld);
      mesh.leftLine.end
        .set(-urlBarWorldWidth/2, -urlBarWorldHeight/2, 0)
        .applyMatrix4(mesh.matrixWorld);

      mesh.topLine.start
        .set(-urlBarWorldWidth/2, urlBarWorldHeight/2, 0)
        .applyMatrix4(mesh.matrixWorld);
      mesh.topLine.end
        .set(urlBarWorldWidth/2, urlBarWorldHeight / 2, 0)
        .applyMatrix4(mesh.matrixWorld);

      mesh.plane.setFromCoplanarPoints(
        mesh.leftLine.start,
        mesh.leftLine.end,
        mesh.topLine.end
      );
    };

    return mesh;
  })();
  object.add(urlMesh);
  object.urlMesh = urlMesh;

  const gridMesh = (() => {
    const canvas = document.createElement('canvas');
    canvas.width = gridWidth;
    canvas.height = gridHeight;
    const ctx = canvas.getContext('2d');

    const geometry = new THREE.PlaneBufferGeometry(gridWorldWidth, gridWorldHeight);
    const texture = new THREE.Texture(
      canvas,
      THREE.UVMapping,
      THREE.ClampToEdgeWrapping,
      THREE.ClampToEdgeWrapping,
      THREE.NearestFilter,
      THREE.NearestFilter,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
      1
    );
    texture.needsUpdate = true;
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      // side: THREE.DoubleSide,
      transparent: true,
      alphaTest: 0.9,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = -(urlBarWorldHeight + gridWorldHeight/2);

    const _updateGrid = () => {
      ctx.clearRect(0, 0, gridWidth, gridHeight);

      const currentLinks = _getCurrentLinks();
      for (let i = 0; i < currentLinks.length; i++) {
        const y = i;

        const xOffsetRect = gridSize;
        const yOffsetRect = y * gridSize;
        ctx.fillStyle = '#333';
        ctx.fillRect(xOffsetRect, yOffsetRect, gridWidth - xOffsetRect, gridSize);

        const xOffsetText = gridSize;
        const yOffsetText = y * gridSize;
        ctx.font = '100px Arial';
        ctx.fillStyle = '#FFF';
        ctx.fillText(currentLinks[i], xOffsetText + 80, yOffsetText + gridSize - 80);
      }
      texture.needsUpdate = true;
    };
    _updateGrid();
    mesh.updateGrid = _updateGrid;

    mesh.planes = [];
    const _updatePlanes = () => {
      mesh.planes.length = 0;

      const currentLinks = _getCurrentLinks();
      for (let i = 0; i < currentLinks.length; i++) {
        const x = 0;
        const y = i;

        const yOffsetRectTop = y * gridSize;
        const yOffsetRectBottom = (y+1) * gridSize;

        const leftLine = new THREE.Line3();
        leftLine.start
          .set(
             -gridWorldWidth/2,
             gridWorldHeight/2 - (yOffsetRectTop * gridWorldHeight / gridHeight),
             0
          )
          .applyMatrix4(mesh.matrixWorld);
        leftLine.end
          .set(
             -gridWorldWidth/2,
             gridWorldHeight/2 - (yOffsetRectBottom * gridWorldHeight / gridHeight),
             0
          )
          .applyMatrix4(mesh.matrixWorld);

        const topLine = new THREE.Line3();
        topLine.start
          .set(
            -gridWorldWidth/2,
            gridWorldHeight/2 - (yOffsetRectTop * gridWorldHeight / gridHeight),
            0
          )
          .applyMatrix4(mesh.matrixWorld);
        topLine.end
          .set(
            gridWorldWidth/2,
            gridWorldHeight/2 + (yOffsetRectTop * gridWorldHeight / gridHeight),
            0
          )
          .applyMatrix4(mesh.matrixWorld);

        const plane = new THREE.Plane().setFromCoplanarPoints(
          leftLine.start,
          leftLine.end,
          topLine.end
        );

        mesh.planes.push({
          plane,
          leftLine,
          topLine,
        });
      }
    };
    _updatePlanes();
    mesh.updatePlanes = _updatePlanes;

    return mesh;
  })();
  object.add(gridMesh);
  object.gridMesh = gridMesh;

  object.updatePortalMeshes = () => {
    menuMesh.updateMatrixWorld();

    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    menuMesh.matrixWorld.decompose(position, quaternion, scale);
    const delta = new THREE.Vector3();

    const allPortalMeshes = portalMeshes;
    for (let i = 0; i < allPortalMeshes.length; i++) {
      const portalMesh = allPortalMeshes[i];
      const {y} = portalMesh.coords;

      portalMesh.position.copy(position);
      portalMesh.quaternion.copy(quaternion);
      portalMesh.scale.copy(scale);

      delta.set(-urlBarWorldWidth/2 + gridWorldSize/2, -urlBarWorldHeight - gridWorldSize/2 - y*gridWorldSize, 0);
      delta.applyQuaternion(quaternion);
      portalMesh.position.add(delta);

      if (currentPortal !== -1 && (frontMeshes.indexOf(portalMesh) !== -1 || backMeshes.indexOf(portalMesh) !== -1)) {
        portalMesh.quaternion.premultiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)));
      }

      portalMesh.matrix.compose(portalMesh.position, portalMesh.quaternion, portalMesh.scale);
      portalMesh.matrixWorld.copy(portalMesh.matrix);
      portalMesh.visible = true;
    }
  };

  return object;
})();
scene.add(menuMesh);

/* fetch(registryUrl)
  .then(res => {
    if (res.status >= 200 && res.status < 300) {
      return res.json();
    } else {
      return Promise.reject(new Error('invalid status code: ' + res.status));
    }
  })
  .then(newLinks => {
    links = newLinks;

    for (let i = 0; i < frontMeshes.length; i++) {
      frontMeshes[i].updateTab();
    }
    menuMesh.gridMesh.updateGrid();
    menuMesh.gridMesh.updatePlanes();
  })
  .catch(err => {
    console.warn(err.stack);
  }); */

const keyboardMesh = (() => {
  const object = new THREE.Object3D();

  const planeMesh = (() => {
    const img = new Image();
    img.src = 'img/keyboard.png';
    img.onload = () => {
      texture.needsUpdate = true;
    };
    img.onerror = err => {
      console.warn(err.stack);
    };

    const geometry = new THREE.PlaneBufferGeometry(1, 1 * keyboardHeight / keyboardWidth);
    const texture = new THREE.Texture(
      img,
      THREE.UVMapping,
      THREE.ClampToEdgeWrapping,
      THREE.ClampToEdgeWrapping,
      THREE.NearestFilter,
      THREE.NearestFilter,
      // THREE.LinearMipMapLinearFilter,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
      1
    );
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.DoubleSide,
      transparent: true,
      alphaTest: 0.9,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 1, 1).normalize()
    );
    return mesh;
  })();
  object.add(planeMesh);
  object.planeMesh = planeMesh;

  object.plane = new THREE.Plane();
  object.leftLine = new THREE.Line3();
  object.topLine = new THREE.Line3();
  object.update = () => {
    object.leftLine.start
      .set(-1/2, keyboardHeight / keyboardWidth / 2, 0)
      .applyMatrix4(planeMesh.matrixWorld);
    object.leftLine.end
      .set(-1/2, -keyboardHeight / keyboardWidth / 2, 0)
      .applyMatrix4(planeMesh.matrixWorld);

    object.topLine.start
      .set(-1/2, keyboardHeight / keyboardWidth / 2, 0)
      .applyMatrix4(planeMesh.matrixWorld);
    object.topLine.end
      .set(1/2, keyboardHeight / keyboardWidth / 2, 0)
      .applyMatrix4(planeMesh.matrixWorld);

    object.plane.setFromCoplanarPoints(
      object.leftLine.start,
      object.leftLine.end,
      object.topLine.end
    );
  };

  return object;
})();
keyboardMesh.position.set(0, 0.5, 0);
scene.add(keyboardMesh);

let keyboardMeshAnimation = null;

for (let i = 0; i < controllerMeshes.length; i++) {
  const controllerMesh = controllerMeshes[i];

  const keyMesh = (() => {
    const geometry = new THREE.PlaneBufferGeometry(1, 1);
    const texture = new THREE.Texture(
      null,
      THREE.UVMapping,
      THREE.ClampToEdgeWrapping,
      THREE.ClampToEdgeWrapping,
      THREE.NearestFilter,
      THREE.NearestFilter,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
      1
    );
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.DoubleSide,
      transparent: true,
    });
    const mesh = new THREE.Mesh(geometry, material);
    return mesh;
  })();
  keyboardMesh.planeMesh.add(keyMesh);

  controllerMesh.keyMesh = keyMesh;
}

let keyboardHighlightCanvasCtx = null;
const img = new Image();
img.src = 'img/keyboard-hightlight.svg';
img.onload = () => {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  keyboardHighlightCanvasCtx = ctx;
};
img.onerror = err => {
  console.log(err.stack);
};

const keyMap = [];
fetch('img/keyboard.svg')
  .then(res => res.text())
  .then(keyboardText => {
    const div = document.createElement('div');
    div.innerHTML = keyboardText;
    const keyEls = div.querySelectorAll('svg > g[key]');
    for (let i = 0; i < keyEls.length; i++) {
      const keyEl = keyEls[i];
      const key = keyEl.getAttribute('key');
      const shapeEl = keyEl.children[0];
      const boundings = svgBoundings[shapeEl.tagName.toLowerCase()](shapeEl);
      const {
        left,
        right,
        top,
        bottom,
      } = boundings;
      const x1 = left * keyboardMatrix[0];
      const x2 = right * keyboardMatrix[0];
      const y1 = top * keyboardMatrix[1];
      const y2 = bottom * keyboardMatrix[1];
      keyMap.push([key, x1, y1, x2, y2]);
    }
  })
  .catch(err => {
    console.warn(err.stack);
  });

const compositeScene = new THREE.Scene();

const screenQuad = new ScreenQuad({
  texture1: renderTarget.texture,
  depth1: renderTarget.depthTexture,
});
compositeScene.add(screenQuad);

const position = new THREE.Vector3();
const velocity = new THREE.Vector3();
let lastTime = Date.now();
function animate() {
  const currentTime = Date.now();
  const timePassed = Math.max(currentTime - lastTime, 1);
  lastTime = currentTime;

  const _updateControls = () => {
    if (window.document.pointerLockElement) {
      localVector.set(0, 0, 0);
      if (keys.up) {
        localVector.z--;
      }
      if (keys.down) {
        localVector.z++;
      }
      if (keys.left) {
        localVector.x--;
      }
      if (keys.right) {
        localVector.x++;
      }
      localVector
        .normalize()
        .multiplyScalar(0.1);
      localEuler.setFromQuaternion(fakeDisplay.quaternion, localEuler.order);
      localEuler.x = 0;
      fakeDisplay.position.add(
        localVector
          .applyEuler(localEuler)
      );

      for (let i = 0; i < 2; i++) {
        const gamepad = fakeDisplay.gamepads[i];
        if (gamepad) {
          localVector.copy(fakeDisplay.position)
            .add(
              localVector2.set(-0.1 + (i*0.1*2), -0.1, -0.2)
                .applyQuaternion(fakeDisplay.quaternion)
            ).toArray(gamepad.pose.position);
          fakeDisplay.quaternion.toArray(fakeDisplay.gamepads[i].pose.orientation);
        }
      }

      fakeDisplay.update();
    }
  };
  const _updateControllers = () => {
    const gamepads = _getGamepads();

    for (let i = 0; i < gamepads.length; i++) {
      const gamepad = gamepads[i];
      if (gamepad) {
        const controllerMesh = controllerMeshes[i];
        controllerMesh.position.fromArray(gamepad.pose.position);
        controllerMesh.quaternion.fromArray(gamepad.pose.orientation);
        controllerMesh.updateMatrixWorld();
      }
    }
  };
  const _updateHands = () => {
    if (renderer.vr.frameData && renderer.vr.frameData.hands) {
      for (let i = 0; i < renderer.vr.frameData.hands.length; i++) {
        handMeshes[i].updateFrameData(renderer.vr.frameData.hands[i]);
      }
    }
  };
  const _updateIntersections = () => {
    keyboardMesh.update();
    menuMesh.urlMesh.update();
    menuMesh.gridMesh.updatePlanes();

    const gamepads = _getGamepads();

    for (let i = 0; i < controllerMeshes.length; i++) {
      const controllerMesh = controllerMeshes[i];
      controllerMesh.update();

      const gamepad = gamepads[i];
      let pressed = false;
      let grabbed = false;
      let menuPressed = false;
      if (gamepad) {
        pressed = gamepad.buttons[1].pressed;
        grabbed = gamepad.buttons[2].pressed;
        menuPressed = gamepad.buttons[3].pressed;
      }

      const _setIntersectionDefault = () => {
        controllerMesh.rayMesh.scale.z = rayDistance;
        controllerMesh.rayMesh.updateMatrixWorld();

        controllerMesh.rayDot.visible = false;

        controllerMesh.keyMesh.visible = false;
      };

      // keyboard
      let intersectionKey = null;
      let intersectionPoint = keyboardMesh.visible ? controllerMesh.ray.intersectPlane(keyboardMesh.plane, localVector) : null;
      if (intersectionPoint) {
        const leftIntersectionPoint = keyboardMesh.leftLine.closestPointToPoint(intersectionPoint, true, localVector2);

        const topIntersectionPoint = keyboardMesh.topLine.closestPointToPoint(intersectionPoint, true, localVector3);

        const xFactor = topIntersectionPoint.distanceTo(keyboardMesh.topLine.start) / (1);
        const yFactor = leftIntersectionPoint.distanceTo(keyboardMesh.leftLine.start) / (keyboardHeight / keyboardWidth);
        const distance = controllerMesh.ray.origin.distanceTo(intersectionPoint);

        if (xFactor > 0 && xFactor <= 0.99 && yFactor > 0 && yFactor <= 0.99 && distance < rayDistance) {
          const x = xFactor * keyboardWidth;
          const y = yFactor * keyboardHeight;

          controllerMesh.rayMesh.scale.z = distance;
          controllerMesh.updateMatrixWorld();

          controllerMesh.rayDot.position.z = -distance;
          controllerMesh.updateMatrixWorld();
          controllerMesh.rayDot.visible = true;

          for (let i = 0; i < keyMap.length; i++) {
            const [key, kx1, ky1, kx2, ky2] = keyMap[i];
            if (x >= kx1 && x < kx2 && y >= ky1 && y < ky2) {
              if (keyboardHighlightCanvasCtx) {
                const width = kx2 - kx1;
                const height = ky2 - ky1;
                let imageData = keyboardHighlightCanvasCtx.getImageData(kx1, ky1, width, height);
                /* if (key === 'enter') { // special case the enter key; it has a non-rectangular shape
                  const canvas = document.createElement('canvas');
                  canvas.width = imageData.width;
                  canvas.height = imageData.height;

                  const ctx = canvas.getContext('2d');
                  ctx.putImageData(imageData, 0, 0);
                  ctx.clearRect(0, 0, 80, 140);

                  imageData = ctx.getImageData(0, 0, imageData.width, imageData.height);
                } */

                controllerMesh.keyMesh.material.map.image = imageData;
                controllerMesh.keyMesh.material.map.needsUpdate = true;

                controllerMesh.keyMesh.position
                  .set(
                    -1/2 + ((width/2 + kx1) / keyboardWidth),
                    (keyboardHeight / keyboardWidth)/2 - ((height/2 + ky1) / keyboardHeight * (keyboardHeight / keyboardWidth)),
                     0.01 * (pressed ? 0.5 : 1)
                  );
                controllerMesh.keyMesh.scale.set(
                  width / keyboardWidth,
                  height / keyboardHeight * (keyboardHeight / keyboardWidth),
                  1
                );
                controllerMesh.keyMesh.updateMatrixWorld();
                controllerMesh.keyMesh.visible = true;
              }

              intersectionKey = key;

              break;
            }
          }
        } else {
          intersectionPoint = null;
        }
      }

      // url bar
      let urlCoords = null;
      if (!intersectionPoint) {
        intersectionPoint = menuMesh.visible ? controllerMesh.ray.intersectPlane(menuMesh.urlMesh.plane, localVector) : null;
        if (intersectionPoint) {
          const leftIntersectionPoint = menuMesh.urlMesh.leftLine.closestPointToPoint(intersectionPoint, true, localVector2);

          const topIntersectionPoint = menuMesh.urlMesh.topLine.closestPointToPoint(intersectionPoint, true, localVector3);

          const xFactor = topIntersectionPoint.distanceTo(menuMesh.urlMesh.topLine.start) / urlBarWorldWidth;
          const yFactor = leftIntersectionPoint.distanceTo(menuMesh.urlMesh.leftLine.start) / urlBarWorldHeight;
          const distance = controllerMesh.ray.origin.distanceTo(intersectionPoint);

          if (xFactor > 0 && xFactor <= 0.99 && yFactor > 0 && yFactor <= 0.99 && distance < rayDistance) {
            const x = xFactor * urlBarWidth;
            const y = yFactor * urlBarHeight;

            urlCoords = [x, y];

            controllerMesh.rayMesh.scale.z = distance;
            controllerMesh.updateMatrixWorld();

            controllerMesh.rayDot.position.z = -distance;
            controllerMesh.updateMatrixWorld();
            controllerMesh.rayDot.visible = true;
          } else {
            intersectionPoint = null;
          }
        }
      }

      // grid
      let intersectionLinkIndex = -1;
      if (!intersectionPoint) {
        if (menuMesh.visible) {
          const currentLinks = _getCurrentLinks();

          for (let i = 0; i < currentLinks.length; i++) {
            const planeSpec = menuMesh.gridMesh.planes[i];
            const {plane, leftLine, topLine} = planeSpec;
            intersectionPoint = controllerMesh.ray.intersectPlane(plane, localVector);

            if (intersectionPoint) {
              const leftIntersectionPoint = leftLine.closestPointToPoint(intersectionPoint, true, localVector2);

              const topIntersectionPoint = topLine.closestPointToPoint(intersectionPoint, true, localVector3);

              const xFactor = topIntersectionPoint.distanceTo(topLine.start) / gridWorldWidth;
              const yFactor = leftIntersectionPoint.distanceTo(leftLine.start) / gridWorldHeight;
              const distance = controllerMesh.ray.origin.distanceTo(intersectionPoint);

              if (xFactor > 0 && xFactor <= 0.99 && yFactor > 0 && yFactor <= 0.99 && distance < rayDistance) {
                controllerMesh.rayMesh.scale.z = distance;
                controllerMesh.updateMatrixWorld();

                controllerMesh.rayDot.position.z = -distance;
                controllerMesh.updateMatrixWorld();
                controllerMesh.rayDot.visible = true;

                intersectionLinkIndex = i;

                break;
              } else {
                intersectionPoint = null;
              }
            }
          }
        }
      }

      if (!intersectionPoint) {
        _setIntersectionDefault();
      }

      const lastMenuPressed = lastMenuPresseds[i];
      lastMenuPresseds[i] = menuPressed;
      if (menuPressed && !lastMenuPressed && currentPortal === -1) {
        const opening = keyboardMesh.planeMesh.scale.y < 0.5;
        if (opening) {
          localEuler.setFromQuaternion(camera.quaternion, localEuler.order);
          localEuler.x = 0;
          localEuler.z = 0;

          keyboardMesh.position
            .copy(camera.position)
            .add(
              localVector
                .set(0, -0.5, -1)
                .applyEuler(localEuler)
            );

          menuMesh.position
            .copy(camera.position)
            .add(
              localVector
                .set(0, 0.5, -2)
                .applyEuler(localEuler)
            );

          for (let i = 0; i < controllerMeshes.length; i++) {
            controllerMeshes[i].rayMesh.visible = true;
          }
        } else {
          for (let i = 0; i < controllerMeshes.length; i++) {
            controllerMeshes[i].rayMesh.visible = false;
          }
        }

        localEuler.setFromQuaternion(
          localQuaternion
            .setFromUnitVectors(
              new THREE.Vector3(0, 0, -1),
              keyboardMesh.position.clone()
                .sub(camera.position)
                .normalize()
            ),
          localEuler.order
        );
        localEuler.x = 0;
        localEuler.z = 0;
        keyboardMesh.rotation.copy(localEuler);
        menuMesh.rotation.copy(localEuler);

        const endValue = opening ? 1 : 0;
        const now = Date.now();
        keyboardMeshAnimation = {
          startValue: keyboardMesh.planeMesh.scale.y,
          endValue,
          startTime: now,
          endTime: now + 300,
        };
      }

      const lastGrabbed = lastGrabbeds[i];
      lastGrabbeds[i] = grabbed;
      if (grabbed && !lastGrabbed) {
        const targetObject = objectMeshes.find(objectMesh =>
          objectMesh.position.distanceTo(controllerMesh.position) < 0.1
        );
        if (targetObject) {
          grabbedObjects[i] = targetObject;
        }
      } else if (!grabbed && lastGrabbed) {
        const grabbedObject = grabbedObjects[i];
        if (grabbedObject) {
          grabbedObjects[i] = null;
        }
      }

      const lastPressed = lastPresseds[i];
      lastPresseds[i] = pressed;
      if (pressed && !lastPressed) {
        if (gamepad.hapticActuators) {
          for (let j = 0; j < gamepad.hapticActuators.length; j++) {
            gamepad.hapticActuators[j].pulse(1, 100);
          }
        }

        if (intersectionKey) {
          const code = keyCode(intersectionKey);
          // console.log('click', JSON.stringify(intersectionKey), JSON.stringify(code)); // XXX
          _handleKey(code, false);
        } else if (urlCoords) {
          const [x, y] = urlCoords;
          const textX = x - 10;

          let closestIndex = -1;
          let closestDistance = Infinity;
          for (let i = 0; i < urlMeasures.length; i++) {
            const urlMeasure = urlMeasures[i];
            const distance = Math.abs(urlMeasure - textX);
            if (distance < closestDistance) {
              closestIndex = i;
              closestDistance = distance;
            }
          }
          if (closestIndex !== -1) {
            urlCursor = closestIndex;
            menuMesh.urlMesh.updateText();
          }
        } else if (intersectionLinkIndex !== -1) {
          const oldIframe = (() => {
            for (let i = 0; i < container.childNodes.length; i++) {
              const iframe = container.childNodes[i];
              if (iframe.index === intersectionLinkIndex) {
                return iframe;
              }
            }
            return null;
          })();

          if (!oldIframe) {
            const currentLinks = _getCurrentLinks();
            _openUrl(currentLinks[intersectionLinkIndex], intersectionLinkIndex, framebuffer => {
              const texture = frontMeshes[intersectionLinkIndex].material.map;

              const properties = renderer.properties.get(texture);
              properties.__webglTexture = framebuffer.colorTexture;
              properties.__webglInit = true;

              intersectionLinkIndex;
            });
          } else {
            oldIframe.destroy();
            oldIframe.parentNode.removeChild(oldIframe);
          }
        }
      }
    }
  };
  const _animateKeyboard = () => {
    if (keyboardMeshAnimation) {
      const now = Date.now();
      const factor = Math.pow((now - keyboardMeshAnimation.startTime) / (keyboardMeshAnimation.endTime - keyboardMeshAnimation.startTime), 0.15);

      if (factor < 1) {
        const scaleY = keyboardMeshAnimation.startValue * (1 - factor) + keyboardMeshAnimation.endValue * factor;

        keyboardMesh.planeMesh.scale.y = scaleY;
        keyboardMesh.updateMatrixWorld();
        keyboardMesh.visible = true;

        menuMesh.scale.y = scaleY;
        menuMesh.updateMatrixWorld();
        menuMesh.visible = true;
        for (let i = 0; i < portalMeshes.length; i++) {
          portalMeshes[i].visible = true;
        }
      } else {
        const visible = keyboardMesh.planeMesh.scale.y > 0.5;
        keyboardMesh.visible = visible;
        menuMesh.visible = visible;
        for (let i = 0; i < portalMeshes.length; i++) {
          portalMeshes[i].visible = visible;
        }

        keyboardMeshAnimation = null;
      }
    }
  };
  const _animateControllers = () => {
    const gamepads = _getGamepads();

    for (let i = 0; i < gamepads.length; i++) {
      const gamepad = gamepads[i];
      if (gamepad) {
        const controllerMesh = controllerMeshes[i];

        const {pressed} = gamepad.buttons[1];
        controllerMesh.rayMesh.material.color.setHex(pressed ? RAY_HIGHLIGHT_COLOR : RAY_COLOR);
      }
    }

    /* const loopTime = 1500;
    for (let i = 0; i < controllerMeshes.length; i++) {
      const controllerMesh = controllerMeshes[i];
      localEuler.y = (i === 0 ? -1 : 1) * Math.sin((currentTime % loopTime) / loopTime * Math.PI * 2);
      controllerMesh.quaternion.setFromUnitVectors(
        localVector.set(0, 0, -1),
        localVector2.set(0, -1, -1)
          .normalize()
          .applyEuler(
            localEuler
          )
      );
    } */
  };
  const _pushPlayerUpdate = () => {
    if (_isWsOpen()) {
      playerMatrix.type[0] = MESSAGE_TYPES.PLAYER_MATRIX;
      playerMatrix.id[0] = localPlayerId;

      camera.position.toArray(playerMatrix.hmd.position);
      camera.quaternion.toArray(playerMatrix.hmd.quaternion);

      for (let i = 0; i < controllerMeshes.length; i++) {
        const controllerMesh = controllerMeshes[i];
        playerMatrix.gamepads[i].enabled[0] = 1;
        controllerMesh.position.toArray(playerMatrix.gamepads[i].position);
        controllerMesh.quaternion.toArray(playerMatrix.gamepads[i].quaternion);
      }

      for (let i = 0; i < 2; i++) {
        playerMatrix.hands[i].enabled[0] = +handMeshes[i].visible;
        playerMatrix.hands[i].data.set(handMeshes[i].handFrameData);
      }

      ws.send(playerMatrix);
    }
  };
  const _updateObjects = () => {
    const gamepads = _getGamepads();
    for (let i = 0; i < grabbedObjects.length; i++) {
      const grabbedObject = grabbedObjects[i];

      if (grabbedObject) {
        const gamepad = gamepads[i];

        grabbedObject.position.fromArray(gamepad.pose.position);
        grabbedObject.quaternion.fromArray(gamepad.pose.orientation);
        grabbedObject.updateMatrixWorld();

        if (_isWsOpen()) {
          objectMatrix.type[0] = MESSAGE_TYPES.OBJECT_MATRIX;
          objectMatrix.id[0] = objectMesh.objectId;
          objectMesh.position.toArray(objectMatrix.position);
          objectMesh.quaternion.toArray(objectMatrix.quaternion);

          ws.send(objectMatrix);
        }
      }
    }
  };
  _updateControls();
  _updateControllers();
  _updateHands();
  _updateIntersections();
  _animateKeyboard();
  _animateControllers();
  _pushPlayerUpdate();
  _updateObjects();

  const device = renderer.vr.getDevice();
  if (device && device.constructor.name === 'FakeVRDisplay') {
    camera.position.copy(device.position);
    camera.quaternion.copy(device.quaternion);

    camera.projectionMatrix.fromArray(device._frameData.leftProjectionMatrix);

    renderer.vr.enabled = false;
    renderer.render(scene, camera, renderTarget);
    renderer.vr.enabled = true;
  } else {
    renderer.render(scene, camera, renderTarget);
  }
  renderer.vr.enabled = false;
  renderer.render(compositeScene, camera);
  renderer.vr.enabled = true;

  menuMesh.updatePortalMeshes();

  window.requestAnimationFrame(animate);
}
window.requestAnimationFrame(animate);

const _handleKey = (code, shiftKey) => {
  if (code === 8) { // backspace
    if (urlCursor > 0) {
      urlText = urlText.slice(0, urlCursor - 1) + urlText.slice(urlCursor);
      urlCursor--;
      menuMesh.urlMesh.updateText();
    }
  } else if (code === 46) { // delete
    if (urlCursor < urlText.length) {
      urlText = urlText.slice(0, urlCursor) + urlText.slice(urlCursor + 1);
      menuMesh.urlMesh.updateText();
    }
  } else if (code === 32) { // space
    urlText = urlText.slice(0, urlCursor) + ' ' + urlText.slice(urlCursor);
    urlCursor++;
    menuMesh.urlMesh.updateText();
  } else if (code === 13) { // enter
    _openUrl(urlText);
  } else if (
    code === 9 || // tab
    code === 16 || // shift
    code === 17 || // ctrl
    code === 18 || // alt
    code === 20 || // capslock
    code === 27 || // esc
    code === 91 // win
  ) {
    // nothing
  } else if (code === 37) { // left
    urlCursor = Math.max(urlCursor - 1, 0);
    menuMesh.urlMesh.updateText();
  } else if (code === 39) { // right
    urlCursor = Math.min(urlCursor + 1, urlText.length);
    menuMesh.urlMesh.updateText();
  } else if (code === 38) { // up
    urlCursor = 0;
    menuMesh.urlMesh.updateText();
  } else if (code === 40) { // down
    urlCursor = urlText.length;
    menuMesh.urlMesh.updateText();
  } else if (code === -1) {
    // nothing
  } else {
    let c = keyCode(code);
    if (shiftKey) {
      c = c.toUpperCase();
    }
    urlText = urlText.slice(0, urlCursor) + c + urlText.slice(urlCursor);
    urlCursor++;
    menuMesh.urlMesh.updateText();
  }
};
const _openUrl = (u, index = -1, cb = null) => {
  const iframe = document.createElement('iframe');
  iframe.src = u;
  iframe.hidden = true;
  iframe.index = index;
  iframe.addEventListener('framebuffer', framebuffer => {
    screenQuad.material.uniforms.numTextures.value = 2;

    const colorTexture = new THREE.Texture();
    const colorProperties = renderer.properties.get(colorTexture);
    colorProperties.__webglTexture = framebuffer.colorTexture;
    colorProperties.__webglInit = true;
    screenQuad.material.uniforms.uTexture2.value = colorTexture;

    const depthTexture = new THREE.Texture();
    const depthProperties = renderer.properties.get(depthTexture);
    depthProperties.__webglTexture = framebuffer.depthStencilTexture;
    depthProperties.__webglInit = true;
    screenQuad.material.uniforms.uDepth2.value = depthTexture;

    if (cb) {
      cb(framebuffer);
    }
  });
  iframe.addEventListener('destroy', () => {
    screenQuad.material.uniforms.numTextures.value = 1;

    const frontMesh = frontMeshes[index];
    const texture = frontMesh.material.map;

    const properties = renderer.properties.get(texture);
    properties.__webglTexture = null;
    properties.__webglInit = false;

    frontMesh.updateTab();
  });
  container.appendChild(iframe);
};

window.addEventListener('resize', e => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();

  const device = renderer.vr.getDevice();
  if (device === fakeDisplay) {
    renderer.vr.setDevice(null);
  }
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  if (device === fakeDisplay) {
    renderer.vr.setDevice(fakeDisplay);
  }
});

let displays = [];
const _updateDisplays = () => {
  if (window.navigator.getVRDisplays) {
    window.navigator.getVRDisplays()
      .then(ds => {
        displays = ds;
      })
      .catch(err => {
        console.warn(err);
      });
  }
};
_updateDisplays();
window.addEventListener('vrdisplayconnect', _updateDisplays);
window.addEventListener('vrdisplaydisconnect', _updateDisplays);

const keys = {
  up: false,
  down: false,
  left: false,
  right: false,
};
window.addEventListener('keypress', e => {
  const _normalizeKeycode = keyCode => {
    if (keyCode >= 97 && keyCode <= 122) {
      return keyCode - 32;
    } else {
      return keyCode;
    }
  };

  if (!window.document.pointerLockElement) {
    switch (e.keyCode) {
      case 99: { // C
        if (e.ctrlKey) {
          document.execCommand('copy');
        } else {
          _handleKey(_normalizeKeycode(e.keyCode), e.shiftKey);
        }
        break;
      }
      case 118: { // V
        if (e.ctrlKey) {
          document.execCommand('paste');
        } else {
          _handleKey(_normalizeKeycode(e.keyCode), e.shiftKey);
        }
        break;
      }
      default: {
        _handleKey(_normalizeKeycode(e.keyCode), e.shiftKey);
        break;
      }
    }
  } else {
    switch (e.keyCode) {
      case 105: { // I
        console.log('enable VR');

        const display = displays.find(display =>
          display.constructor.name === 'VRDisplay'
        );
        if (display) {
          if (window.document.pointerLockElement) {
            window.document.exitPointerLock();
          }
          renderer.vr.setDevice(null);

          display.requestPresent([{source: canvas}])
            .then(() => {
              renderer.vr.setDevice(display);

              const eyeParameters = display.getEyeParameters('left');
              const width = eyeParameters.renderWidth * 2;
              const height = eyeParameters.renderHeight;

              // renderTarget.dispose(); // XXX
              renderTarget = _makeRenderTarget(width, height);

              screenQuad.material.uniforms.uTexture1.value = renderTarget.texture;
              screenQuad.material.uniforms.uDepth1.value = renderTarget.depthTexture;
            });
        }
        break;
      }
      case 111: { // O
        console.log('enable ML');

        const display = displays.find(display =>
          display.constructor.name === 'MLDisplay'
        );
        if (display) {
          if (window.document.pointerLockElement) {
            window.document.exitPointerLock();
          }
          renderer.vr.setDevice(null);

          display.requestPresent([{source: canvas}])
            .then(() => {
              renderer.vr.setDevice(display);

              scene.background = null;
            });
        }
        break;
      }
      case 112: { // P
        if (!voicechatEnabled) {
          console.log('enable voicechat');

          audioCtx = new AudioContext({
            sampleRate: 48000,
          });
          THREE.AudioContext.setContext(audioCtx);

          audioListener = new THREE.AudioListener();
          camera.add(audioListener);

          navigator.mediaDevices.getUserMedia({
            audio: true,
          })
            .then(mediaStream => {
              microphoneMediaStream = mediaStream;

              const microphoneSourceNode = audioCtx.createMediaStreamSource(mediaStream);

              const scriptProcessorNode = audioCtx.createScriptProcessor(4096, 1, 1);
              scriptProcessorNode.onaudioprocess = e => {
                const float32Array = e.inputBuffer.getChannelData(0);

                if (_isWsOpen()) {
                  const audioMessage = new ArrayBuffer(Uint32Array.BYTES_PER_ELEMENT*2 + float32Array.byteLength);
                  new Uint32Array(audioMessage, 0, 1)[0] = MESSAGE_TYPES.AUDIO;
                  new Uint32Array(audioMessage, Uint32Array.BYTES_PER_ELEMENT, 1)[0] = localPlayerId;
                  new Float32Array(audioMessage, Uint32Array.BYTES_PER_ELEMENT*2, float32Array.length).set(float32Array);
                  ws.send(audioMessage);
                }

                e.outputBuffer.getChannelData(0).fill(0);
              };
              microphoneSourceNode.connect(scriptProcessorNode);
              scriptProcessorNode.connect(audioCtx.destination);

              for (let i = 0; i < playerMeshes.length; i++) {
                _bindPlayerMeshAudio(playerMeshes[i]);
              }
            });
          voicechatEnabled = true;
        }
        break;
      }
    }
  }
});
window.addEventListener('keydown', e => {
  if (window.document.pointerLockElement) {
    switch (e.keyCode) {
      case 87: { // W
        keys.up = true;
        if (!window.document.pointerLockElement) {
          renderer.domElement.requestPointerLock();
        }
        break;
      }
      case 83: { // S
        keys.down = true;
        if (!window.document.pointerLockElement) {
          renderer.domElement.requestPointerLock();
        }
        break;
      }
      case 65: { // A
        keys.left = true;
        if (!window.document.pointerLockElement) {
          renderer.domElement.requestPointerLock();
        }
        break;
      }
      case 68: { // D
        keys.right = true;
        if (!window.document.pointerLockElement) {
          renderer.domElement.requestPointerLock();
        }
        break;
      }
      case 69: { // E
        fakeDisplay.gamepads[1].buttons[3].pressed = true;
        break;
      }
    }
  }
});
window.addEventListener('keyup', e => {
  if (window.document.pointerLockElement) {
    switch (e.keyCode) {
      case 87: { // W
        keys.up = false;
        break;
      }
      case 83: { // S
        keys.down = false;
        break;
      }
      case 65: { // A
        keys.left = false;
        break;
      }
      case 68: { // D
        keys.right = false;
        break;
      }
      case 69: { // E
        fakeDisplay.gamepads[1].buttons[3].pressed = false;
        break;
      }
    }
  }
});
window.addEventListener('mousedown', () => {
  if (!window.document.pointerLockElement) {
    renderer.domElement.requestPointerLock();
  } else {
    const gamepad = fakeDisplay.gamepads[1];
    if (gamepad) {
      fakeDisplay.gamepads[1].buttons[1].pressed = true;
    }
  }
});
window.addEventListener('mouseup', () => {
  const gamepad = fakeDisplay.gamepads[1];
  if (gamepad) {
    gamepad.buttons[1].pressed = false;
  }
});
window.addEventListener('mousemove', e => {
  if (window.document.pointerLockElement) {
    const {movementX, movementY} = e;
    localEuler.setFromQuaternion(fakeDisplay.quaternion, localEuler.order);
    localEuler.y -= movementX * 0.01;
    localEuler.x -= movementY * 0.01;
    localEuler.x = Math.min(Math.max(localEuler.x, -Math.PI/2), Math.PI/2);
    fakeDisplay.quaternion.setFromEuler(localEuler);

    fakeDisplay.update();
  }
});
window.document.addEventListener('paste', e => {
  const {clipboardData} = e;
  const items = Array.from(clipboardData.items);
  const item = items.find(item => item.kind === 'string');
  if (item) {
    item.getAsString(s => {
      urlText = urlText.slice(0, urlCursor) + s + urlText.slice(urlCursor);
      urlCursor += s.length;
      menuMesh.urlMesh.updateText();
    });
  }
});
window.addEventListener('dragover', e => {
  e.preventDefault();
});
window.addEventListener('drop', e => {
  e.preventDefault();

  console.log('drop', e);
});
