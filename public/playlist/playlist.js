
// YAML Schema for validation
const yamlSchema = {
    type: "object",
    properties: {
        title: { type: "string", default: "Playlist" },
        autoplay: { type: "boolean", default: true },
        loop: { type: "integer", default: -1 },
        speed: { type: "number" },
        controls: { type: "boolean" },
        playing: { type: "integer" },
        onStop: {
            type: "object",
            properties: {
                goBack: { type: "boolean" }
            }
        },
        media: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    type: { type: "string", enum: ["video", "audio", "image"], default: "video"},
                    url: { type: "string" },
                    poster: { type: "string" },
                    banner: { type: "string" },
                    title: { type: "string" },
                    duration: { type: "number" },
                    start: { type: "string", default: '0:00' },
                    end: { type: "string", default: '' },
                    speed: { type: "number" },
                    controls: { type: "boolean" },
                    loop: { type: "integer" }
                },
                required: ["type", "url", "title"]
            }
        }
    },
    required: ["media"]
};

const validate = (new ajv7.Ajv()).compile(yamlSchema);

let currentConfig = null;
let currentMediaIndex = 0;
let mediaElements = [];
let currentMediaLoopCount = 0;

document.querySelector('label[for="playlist-yaml-editor"]').title = jsyaml.dump(yamlSchema, { flowLevel: 5 })
const playlistYamlEditor = CodeMirror.fromTextArea(document.getElementById('playlist-yaml-editor'), {
    mode: 'text/x-yaml',
    theme: 'dracula',
    lineNumbers: true,
    autoRefresh: true,
    lineWrapping: true,
    viewportMargin: Infinity,
    indentUnit: 2,
    indentWithTabs: false,
    smartIndent: true,
    electricChars: true,
    matchBrackets: true,
    autoCloseBrackets: true,
    styleActiveLine: true,
    foldGutter: true,
    gutters: ["CodeMirror-linenumbers", "CodeMirror-foldgutter"],
    tabSize: 2,
    extraKeys: {
        "Tab": function(cm) {
            if (cm.somethingSelected()) {
                cm.indentSelection("add");
            } else {
                cm.replaceSelection("  ", "end");
            }
        },
        "Shift-Tab": function(cm) {
            cm.indentSelection("subtract");
        },
        "Ctrl-/": "toggleComment",
        "Cmd-/": "toggleComment"
    },
    value: ``
});
playlistYamlEditor.refresh();

// Get storage key from URL parameter
function getStorageKey() {
    const params = new URLSearchParams(window.location.search);
    return params.get('id') || 'default-playlist';
}

// Load configuration from localStorage
function loadConfig() {
    const key = getStorageKey();
    const stored = localStorage.getItem(key);
    document.getElementById('playlist-key').innerText = key;

    if (stored) {
        try {
            const config = JSON.parse(stored);
            validateConfig(config)
            const yamlText = jsyaml.dump(config);
            playlistYamlEditor.setValue(yamlText);
            currentConfig = config;
            renderPlayer();
            document.getElementById('validation-status').innerHTML = '<span style="color: green;">Configuration loaded successfully</span>';
        } catch (error) {
            document.getElementById('validation-status').innerHTML = '<span style="color: red;">Error loading config: ' + error.message + '</span>';
        }
    } else {
        // Default configuration
        const defaultConfig = {
            title: "My Playlist",
            autoplay: false,
            loop: 0,
            speed: 1,
            playing: 0,
            media: [
                {
                    type: "video",
                    url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
                    title: "Sample Video",
                    duration: 10,
                    start: "0:05",
                    end: "0:15",
                    speed: 1.5,
                    loop: 1
                }
            ]
        };
        const yamlText = jsyaml.dump(defaultConfig);
        playlistYamlEditor.setValue(yamlText);
    }
}

// Save configuration to localStorage
function saveConfig(config) {
    const key = getStorageKey();
    localStorage.setItem(key, JSON.stringify(config));
}

function validateConfig(config) {
    if (!validate(config)) {
        const errors = validate.errors.map(err => `${err.instancePath} ${err.message}`).join(', ');
        document.getElementById('validation-status').innerHTML = '<span style="color: red;">Validation errors: ' + errors + '</span>';
        return false;
    }

    return true;
}

// Validate and save YAML
function validateAndSave() {
    const yamlText = playlistYamlEditor.getValue();
    // const yamlText = document.getElementById('playlist-yaml-editor').value;

    try {
        const config = jsyaml.load(yamlText);

        if (validateConfig(config)) {
            currentConfig = config;
            saveConfig(config);
            renderPlayer();
            document.getElementById('validation-status').innerHTML = '<span style="color: green;">Configuration saved successfully</span>';
        }
    } catch (error) {
        document.getElementById('validation-status').innerHTML = '<span style="color: red;">YAML parsing error: ' + error.message + '</span>';
    }
}

function isEditorMode() {
    const params = new URLSearchParams(window.location.search);
    return !params.get('id') || params.get('mode') == 'edit';
}

document.getElementById('editor-container-ctrl').style.display = isEditorMode() ? 'block' : 'none';

// Render the media player
function renderPlayer() {
    if (!currentConfig || !currentConfig.media || currentConfig.media.length === 0) {
        return;
    }

    const playerContainer = document.getElementById('media-player');
    playerContainer.innerHTML = '';

    if (currentConfig.title) {
        const title = document.createElement('h2');
        title.textContent = currentConfig.title;
        playerContainer.appendChild(title);
    }

    const currentMedia = currentConfig.media[currentMediaIndex];
    let mediaElement;

    const mediaTitle = document.createElement('h3');
    mediaTitle.textContent = currentMedia.title;
    playerContainer.appendChild(mediaTitle);

    if (currentMedia.type === 'video') {
        mediaElement = document.createElement('video');
        mediaElement.controls = currentMedia.controls === undefined ? currentConfig.controls : currentMedia.controls;
        mediaElement.style.width = '99%';
        mediaElement.style.height = '96%';

    } else if (currentMedia.type === 'audio') {
        mediaElement = document.createElement('audio');
        mediaElement.controls = currentMedia.controls === undefined ? currentConfig.controls : currentMedia.controls;
        mediaElement.style.width = '99%';
    } else if (currentMedia.type === 'image') {
        mediaElement = document.createElement('img');
        mediaElement.style.maxWidth = '99%';
        mediaElement.style.maxHeight = '96%';

        // For images, set duration timeout
        if (currentMedia.duration) {
            setTimeout(() => {
                nextMedia();
            }, currentMedia.duration * 1000);
        }
    }

    if (mediaElement) {
        mediaElement.src = currentMedia.url;
        mediaElement.playbackRate = currentMedia.speed || currentConfig.speed || 1;

        if (currentMedia.type !== 'image') {
            const mediaListeners = [
                {
                    type:'loadedmetadata',
                    call: function() {
                        mediaElement.currentTime = 0;
                        if (currentMedia.start) {
                            mediaElement.currentTime = parseTimeString(currentMedia.start);
                        }
                    }
                },
                {
                    type: 'timeupdate',
                    call: function() {
                        if (currentMedia.end && mediaElement.currentTime >= parseTimeString(currentMedia.end)) {
                            // fix: media is still around while executing nextMedia()
                            mediaListeners.forEach((listed) => {
                                mediaElement.removeEventListener(listed.type, listed.call);
                            })
                            mediaElement.pause();

                            nextMedia();
                        }
                    }
                },
                {
                    type: 'ended',
                    call: function() {
                        nextMedia();
                    }
                },
                {
                    type: 'click',
                    call: function() {
                        if (currentMedia.controls) {
                            return;
                        }

                        if(!mediaElement.paused) {
                            mediaElement.pause();
                        } else {
                            mediaElement.play();
                        }
                    }
                }
            ];
            mediaListeners.forEach((listed) => {
                mediaElement.addEventListener(listed.type, listed.call);
            })

            if (currentConfig.autoplay) {
                mediaElement.autoplay = true;
            }
        }

        if (currentMedia.poster) {
            mediaElement.poster = currentMedia.poster;
        }

        if (currentMedia.banner) {
            const controlBanner = document.createElement('img');
            controlBanner.src = currentMedia.banner;
            controlBanner.style.maxWidth = '99%';
            // controlBanner.style.maxHeight = '96%';
            controlBanner.addEventListener('click', () => {
                if(!mediaElement.paused) {
                    mediaElement.pause();
                } else {
                    mediaElement.play();
                }
            });
            playerContainer.appendChild(controlBanner);
        }

        playerContainer.appendChild(mediaElement);

        // Navigation controls
        const controls = document.createElement('div');

        // style="width: 30%; height: 30%;"
        controls.innerHTML = `
            <button onclick="previousMedia()">Prev</button>
            <span>Media ${currentMediaIndex + 1} of ${currentConfig.media.length}</span>
            <button onclick="nextMedia()">Next</button>
        `;
        playerContainer.appendChild(controls);
    }
}

// Parse time string (hh:mm:ss, mm:ss, or ss)
function parseTimeString(timeStr) {
    const parts = timeStr.split(':').map(Number);
    if (parts.length === 1) return parts[0]; // ss
    if (parts.length === 2) return parts[0] * 60 + parts[1]; // mm:ss
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]; // hh:mm:ss
    return 0;
}

// Handle media end (considering individual media loop)
function handleMediaEnd() {
    if (!currentConfig || !currentConfig.media) return;

    const currentMedia = currentConfig.media[currentMediaIndex];
    const mediaLoop = currentMedia.loop || 0;

    // Check if current media should loop
    if (mediaLoop === -1 || currentMediaLoopCount < mediaLoop) {
        if (mediaLoop !== -1) {
            currentMediaLoopCount++;
        }

        // Restart current media
        const mediaElement = document.querySelector('#media-player video, #media-player audio');
        if (mediaElement && currentMedia.type !== 'image') {
            mediaElement.currentTime = 0;
            if (currentMedia.start) {
                mediaElement.currentTime = parseTimeString(currentMedia.start);
            }
            mediaElement.play();
        } else if (currentMedia.type === 'image') {
            // For images, just restart the timer
            if (currentMedia.duration) {
                setTimeout(() => {
                    handleMediaEnd();
                }, currentMedia.duration * 1000);
            }
        }
    } else {
        // Move to next media
        currentMediaLoopCount = 0;
        nextMedia();
    }
}

// Navigate to next media
function nextMedia() {
    if (!currentConfig || !currentConfig.media) return;

    // Clean up current media before switching

    currentMediaIndex++;
    currentMediaLoopCount = 0;

    if (currentMediaIndex < currentConfig.media.length) {
        renderPlayer();
        return;
    }

    // Playlist has ended - check global loop settings
    if (currentConfig.loop === -1 || currentConfig.loop > 1) {
        // Restart playlist
        currentMediaIndex = 0;
        if (currentConfig.loop > 1) {
            currentConfig.loop--;
        }
        renderPlayer();
        return
    }

    // Stop playlist - go back to last media and don't play
    currentMediaIndex = currentConfig.media.length - 1;
    renderPlayer();

    // Stop any currently playing media
    const mediaElement = document.querySelector('#media-player video, #media-player audio');
    if (mediaElement) {
        mediaElement.pause();
    }

    if (currentConfig.onStop?.goBack) {
        history.back();
    }

    // Show playlist ended message
    const playerContainer = document.getElementById('media-player');
    const endMessage = document.createElement('div');
    endMessage.innerHTML = '<p><strong>Playlist ended</strong></p>';
    playerContainer.appendChild(endMessage);
    return;


}

// Navigate to previous media
function previousMedia() {
    if (!currentConfig || !currentConfig.media) return;

    currentMediaIndex--;
    currentMediaLoopCount = 0;

    if (currentMediaIndex < 0) {
        currentMediaIndex = currentConfig.media.length - 1;
    }
    renderPlayer();
}

document.addEventListener('visibilitychange', () => {
    const mediaElement = document.querySelector('#media-player video, #media-player audio');
    if (document.visibilityState === 'hidden' && mediaElement && !mediaElement.paused) {
        mediaElement.pause();
    }

    if (document.visibilityState === 'visible' && mediaElement?.paused) {
        mediaElement.play();
    }
})

// Initialize on page load
window.addEventListener('load', loadConfig);
window.addEventListener('htmx:load', loadConfig);


