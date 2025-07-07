
const auth = firebase.auth();
const db = firebase.firestore();

// YAML Schema for validation
const dataSchema = {
    type: "object",
    properties: {
        post: { type: "string" },
        title: { type: "string" },
        redirect: { type: "string" },
        countdown: { type: "number" },
        markdown: { type: "string" },
        generate: {
            type: ["object"],
            properties: {
                context: { type: "string" },
                yaml: { type: "string" }
            }
        },
        storage: {
            type: ["array"],
            items: {
                type: ["object"],
                properties: {
                    key: { type: "string" },
                    value: { anyOf: [
                        {type:"object"}, {type:"array"}, {type:"string"}, {type:"null"}
                    ] },
                },
                required: ["key"]
            }
        }
    }
};

const validateDataSchema = (new ajv7.Ajv()).compile(dataSchema);

let currentUser = null;
let isAdmin = false;
let editType = 'post';
let originalData = null;
let currentData = null;
let selectedPostId = null;

document.querySelector('label[for="yaml-editor"]').title = jsyaml.dump(dataSchema, { flowLevel: 5 })
document.getElementById('yaml-editor').placeholder = jsyaml.dump(dataSchema.properties, { flowLevel: 5 })

const yamlEditor = CodeMirror.fromTextArea(document.getElementById('yaml-editor'), {
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
yamlEditor.refresh();

// Get post ID from URL parameter
function getPostId() {
    const params = new URLSearchParams(window.location.search);
    return params.get('post');
}

function isAdminMode() {
    // - no specific post
    // - mode=admin
    const params = new URLSearchParams(window.location.search);
    return !params.get('post') || params.get('mode') == 'admin';
}

// Authentication functions
function login() {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider).catch(error => {
        updateStatus('Login error: ' + error.message, 'error');
    });
}

function logout() {
    auth.signOut();
}

// Auth state observer
auth.onAuthStateChanged(async function(user) {
    currentUser = user;
    isAdmin = user && isAdminMode() && await checkAdminStatus(user.uid);

    updateUI();
    loadGuestContent();

    if (isAdmin) {
        loadAdminItems();
    }

});

// Check if user is admin
async function checkAdminStatus(uid) {
    try {
        const doc = await db.collection('users').doc(uid).get();
        return doc.exists && doc.data().role === 'admin';
    } catch (error) {
        console.error('Error checking admin status:', error);
        return false;
    }
}

// Update UI based on auth state
function updateUI() {
    const loginBtn = document.getElementById('login-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const userInfo = document.getElementById('user-info');
    const adminPanel = document.getElementById('admin-panel');
    const showAdmin = document.getElementById('show-admin');
    const showAdminCtrl = document.getElementById('show-admin-ctrl');

    loginBtn.style.display = currentUser ? 'none' : 'inline-block';
    logoutBtn.style.display = currentUser ? 'inline-block' : 'none';
    userInfo.textContent = currentUser ? `Logged in as: ${currentUser.displayName || currentUser.email}` : 'Not logged in (Guest)';

    showAdminCtrl.style.display = isAdmin ? 'block' : 'none';
    adminPanel.style.display = isAdmin && showAdmin.checked ? 'block' : 'none';
}

// Data operations
async function pullData() {
    const itemName = document.getElementById('item-name').value || document.getElementById('item-select').value;

    if (!itemName) {
        updateStatus('Please select or enter an item name', 'error');
        return;
    }

    try {
        const collection = editType === 'post' ? 'posts' : 'users';
        const doc = await db.collection(collection).doc(itemName).get();

        if (doc.exists) {
            originalData = doc.data();
            currentData = { ...originalData };
            validateDataSchema(currentData);
            const yamlText = jsyaml.dump(currentData);
            yamlEditor.setValue(yamlText);
            updateStatus('Data loaded successfully', 'success');
            updateDiff();
        } else {
            updateStatus('Item not found', 'error');
        }
    } catch (error) {
        updateStatus('Error loading data: ' + error.message, 'error');
    }
}

async function previewData() {
    let data = null;

    try {
        data = jsyaml.load(yamlEditor.getValue());
    } catch (error) {
        updateStatus(`Error: <pre>${error.message}</pre>`, 'error');
        return;
    }

    updateDiff();
    processAndDisplayContent(data)
}

async function pushData() {
    const collection = editType === 'post' ? 'posts' : 'users';
    const itemName = document.getElementById('item-name').value || document.getElementById('item-select').value;
    const yamlText = yamlEditor.getValue();

    if (!itemName) {
        updateStatus('Please select or enter an item name', 'error');
        return;
    }

    if (!yamlText && !document.getElementById('item-name').value) {
        if (confirm(`Please confirm wanting to DELETE ${itemName}`)) {
            await db.collection(collection).doc(itemName).delete();
            updateStatus('Data deleted successfully', 'success');
            originalData = currentData = null;
            updateDiff();
            loadAdminItems(); // Refresh the select list
        } else {
            updateStatus('Data deletion canceled', 'success');
        }
        return
    }


    try {
        const data = jsyaml.load(yamlText);

        if (!validateDataSchema(data)) {
            const errors = validateDataSchema.errors.map(err => `${err.instancePath} ${err.message}`).join('\n');
            updateStatus(`Validation errors: <pre> ${errors} </pre>`, 'error');
            return
        }

        await db.collection(collection).doc(itemName).set(data);
        updateStatus('Data saved successfully', 'success');
        originalData = { ...data };
        currentData = { ...data };
        updateDiff();
        loadAdminItems(); // Refresh the select list
    } catch (error) {
        updateStatus('Error saving data: ' + error.message, 'error');
    }
}

// Diff functionality
function diffData() {
    if (!originalData) return '';

    try {
        const yamlText = yamlEditor.getValue();
        const newData = jsyaml.load(yamlText);
        currentData = newData;

        const originalYaml = jsyaml.dump(originalData);
        const newYaml = jsyaml.dump(newData);

        const diff = Diff.createPatch('data', originalYaml, newYaml, 'Original', 'Current');
        return diff;
    } catch (error) {
        return 'Error creating diff: ' + error.message;
    }
}

function updateDiff() {
    const diffDisplay = document.getElementById('diff-display');
    const showDiff = document.getElementById('show-diff').checked;

    if (!showDiff) {
        return;
    }

    if (originalData) {
        const diff = diffData();
        diffDisplay.innerHTML = `<pre>${diff}</pre>`;
    }
}

// UI helpers
function toggleEditType() {
    editType = document.querySelector('input[name="edit-type"]:checked').value;
    loadAdminItems();
}

function toggleAdmin() {
    const adminDisplay = document.getElementById('admin-panel');
    const showAdmin = document.getElementById('show-admin').checked;
    adminDisplay.style.display = showAdmin ? 'block' : 'none';
}

function toggleDiff() {
    const diffDisplay = document.getElementById('diff-display');
    const showDiff = document.getElementById('show-diff').checked;
    diffDisplay.style.display = showDiff ? 'block' : 'none';
    if (showDiff) {
        updateDiff();
    }
}

function cancelEdit() {
    yamlEditor.setValue('');
    document.getElementById('item-name').value = '';
    document.getElementById('item-select').value = '';
    originalData = null;
    currentData = null;
    updateStatus('Edit cancelled', 'info');
    updateDiff();
}

function loadSelectedItem() {
    const select = document.getElementById('item-select');
    document.getElementById('item-name').value = select.value;

    pullData()
}

async function loadAdminItems() {
    if (!isAdmin) return;

    try {
        const collection = editType === 'post' ? 'posts' : 'users';
        const snapshot = await db.collection(collection).get();

        const select = document.getElementById('item-select');
        select.innerHTML = '<option value="">Select item...</option>';

        snapshot.forEach(doc => {
            let textContent;
             if (editType === 'user') {
                const userData = doc.data();
                textContent = `${ userData.role || 'user' } : ${ userData.displayName || userData.email }`
             }
            const option = document.createElement('option');
            option.textContent = textContent ? `${textContent} (${doc.id})` : doc.id;
            option.value = doc.id;

            select.appendChild(option);
        });
    } catch (error) {
        updateStatus('Error loading items: ' + error.message, 'error');
    }
}

async function loadGuestContent() {
    const postId = getPostId();

    let docRef = db.collection('posts').doc(postId || (currentUser?.uid ? 'home' : 'guest'));

    if (!postId && currentUser?.uid) {
        docRef = db.collection('users').doc(currentUser.uid);
    }

    try {
        const doc = await docRef.get();
        let data = null;

        if (doc.exists) {
            data = doc.data();
        } else {
            // Load default guest data
            const guestDoc = await db.collection('posts').doc('guest').get();
            if (guestDoc.exists) {
                data = guestDoc.data();
            }
        }

        processAndDisplayContent(data);
    } catch (error) {
        displayContentError(error)
    }
}

async function processAndDisplayContent(data) {
    if (!data) {
        document.getElementById('content-display').innerHTML = '<p>No content available</p>';
        return;
    }

    let context = {
        ...data,
        user: currentUser,
        window,
    };

    if (data?.generate?.context) {
        context = Function('ctx', `'use strict'; ${data.generate.context};`)(context)

        if (!data.generate.yaml){
            data = { ...data, ...context }
        }
    }

    // useless but leaving it
    if (data?.generate?.yaml) {
        try {
            const generatedYaml = Mustache.render(data.generate.yaml, context);
            const generatedData = jsyaml.load(generatedYaml);

            data = { ...data, ...generatedData };

        } catch (error) {
            displayContentError(error, `<pre>${error.message}</pre>`);
            return
        }
    }
    if (data?.post) {
        const subDoc = await db.collection('posts').doc(data.post).get();
        if (subDoc.exists) {
            data = { ...data, ...subDoc.data()}
        } else {
            data.markdown = `# 404 \n## No post (${data.post})`
        }
    }

    if (!validateDataSchema(data)) {
        const errors = validateDataSchema.errors.map(err => `${err.instancePath} ${err.message}`).join('\n');
        displayContentError(validateDataSchema.errors, `Invalid YAML: <pre>${errors}</pre>`);
        return;
    }

    displayContent(data);
}

function displayContentError(error, message) {
    document.getElementById('content-display').innerHTML = message || '<p>Error loading content</p>';
    console.error('Error loading content:', error);
}

function displayContent(data) {
    const contentDisplay = document.getElementById('content-display');
    const countdownContainer = document.getElementById('countdown-container');

    let html = '';

    if (data.title) {
        document.getElementById("window-title").innerText;
    }

    if (data.markdown) {
        html += marked.parse(data.markdown);
    }

    if (data.storage) {
        // Display storage data as formatted JSON
        html += `<div>
        <input type="checkbox" id="show-storage" onchange="document.getElementById('storage-yaml').style.display = checked ? 'block' : 'none'" >
        <label for="show-storage">Show Storage</label>
        <textarea id="storage-yaml" rows="9" style="width: 99%; display: none;" readonly>${jsyaml.dump(data.storage)}</textarea>
        </div>`;

        data.storage.forEach(item => {
            if (!item.value) {
                localStorage.removeItem(item.key);
            } else if (typeof(item.value) === 'string') {
                localStorage.setItem(item.key, item.value);
            } else {
                localStorage.setItem(item.key, JSON.stringify(item.value));
            }

        });
    }

    // Handle redirect
    if (data.redirect) {
        html += `
        <div><h3>Redirect:</h3>
        <pre>${data.redirect}</pre></div>
        <p><a href="${data.redirect}">Click here to redirect</a></p>
        `;

        countdownContainer.style.display = 'block';
        let countdown = data.countdown || 5;

        const timer = setInterval(() => {
            document.getElementById('countdown').textContent = countdown;
            countdown--;

            if (countdown < 0) {
                clearInterval(timer);
                // window.history.pushState({}, {}, data.redirect)
                // window.location.assign(data.redirect)
            }

            if (isAdmin) {
                clearInterval(timer);
            }
        }, 1000);

        countdownContainer.addEventListener('click', () => {
            clearInterval(timer);
            console.log('Countdown stopped', countdown, 'timer', timer);
        })

    }

    contentDisplay.innerHTML = html;
}

function updateStatus(message, type, delay) {
    const statusBar = document.getElementById('status-bar');
    const htmlMessage = `<span style="color: ${type === 'error' ? 'red' : type === 'success' ? 'green' : 'blue'}">${message}</span>`;
    statusBar.innerHTML = htmlMessage;

    setTimeout(() => {
        if (statusBar.innerHTML === htmlMessage)
        statusBar.innerHTML = '';
        }, delay || 1000)
}

// Initialize
window.addEventListener('load', () => {
    selectedPostId = getPostId();
    updateUI();
});

//
//document.addEventListener('htmx:beforeSwap', function(evt) {
//    if (evt.detail.pathInfo.requestPath === '/my-endpoint') {
//        let parser = new DOMParser();
//        let doc = parser.parseFromString(evt.detail.serverResponse, 'text/html');
//        let elementToModify = doc.querySelector('link, scripts');
//        // doc.querySelectorAll('script[src^=http], link[href^=http]').forEach(t => t.remove())
//        evt.detail.serverResponse = doc.documentElement.outerHTML;
//}
