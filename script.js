import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy, doc, updateDoc, arrayUnion, arrayRemove } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyAxuyaH2Oszddmsd8fNlcc-tGo6QN3r_GQ",
    authDomain: "bikehub-4fb57.firebaseapp.com",
    projectId: "bikehub-4fb57",
    storageBucket: "bikehub-4fb57.firebasestorage.app",
    messagingSenderId: "952858705924",
    appId: "1:952858705924:web:be6548cf16b2463d4ff551",
    measurementId: "G-2T4HXRLYQL"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let currentUsername = localStorage.getItem('bikehub_username') || "";
let routes = JSON.parse(localStorage.getItem('bikehub_routes')) || ["Γύρος Λίμνης", "Γεφυράκια (16χλμ)", "Καταρράκτης Κλίφκης"];
let startPoints = JSON.parse(localStorage.getItem('bikehub_startpoints')) || ["Πλατεία Μαβίλης", "Καφετέρια εδώ", "Κατσικά καφετέρια diman"];
let showAllRides = false;

window.addEventListener('DOMContentLoaded', () => {
    if (currentUsername) document.getElementById('name-modal').style.display = 'none';
    
    updateShareLinks();
    initRealtimeChat();
    initRealtimeRides();
    populateDropdowns();

    document.getElementById('save-name-btn').addEventListener('click', saveModalUsername);
    document.getElementById('send-chat-btn').addEventListener('click', sendChatMessage);
    document.getElementById('add-ride-btn').addEventListener('click', addNewRide);
    document.getElementById('load-more-btn').addEventListener('click', () => { showAllRides = true; initRealtimeRides(); });
});

function populateDropdowns() {
    const rS = document.getElementById('ride-title-select');
    const sS = document.getElementById('start-point-select');
    rS.innerHTML = '<option value="">Επιλέξτε διαδρομή...</option><option value="NEW">--- Νέα διαδρομή ---</option>' + routes.map(r => `<option value="${r}">${r}</option>`).join('');
    sS.innerHTML = '<option value="">Επιλέξτε αφετηρία...</option><option value="NEW">--- Νέο σημείο ---</option>' + startPoints.map(s => `<option value="${s}">${s}</option>`).join('');
}

window.checkNewRoute = () => {
    if (document.getElementById('ride-title-select').value === 'NEW') {
        const val = prompt("Εισάγετε νέα διαδρομή:");
        if (val) { routes.push(val); localStorage.setItem('bikehub_routes', JSON.stringify(routes)); populateDropdowns(); }
    }
};

window.checkNewPoint = () => {
    if (document.getElementById('start-point-select').value === 'NEW') {
        const val = prompt("Εισάγετε νέο σημείο αφετηρίας:");
        if (val) { startPoints.push(val); localStorage.setItem('bikehub_startpoints', JSON.stringify(startPoints)); populateDropdowns(); }
    }
};

window.joinRide = async (id) => { await updateDoc(doc(db, "rides", id), { participants: arrayUnion(currentUsername) }); };
window.leaveRide = async (id) => { await updateDoc(doc(db, "rides", id), { participants: arrayRemove(currentUsername) }); };

async function addNewRide() {
    const title = document.getElementById('ride-title-select').value;
    const start = document.getElementById('start-point-select').value;
    const date = document.getElementById('ride-date').value;
    if (!title || title === "NEW" || !start || start === "NEW" || !date) return alert("Συμπληρώστε σωστά!");
    await addDoc(collection(db, "rides"), { title, start, date: date.replace('T', ' '), participants: [currentUsername], timestamp: Date.now() });
    location.reload();
}

function initRealtimeRides() {
    onSnapshot(query(collection(db, "rides"), orderBy("timestamp", "desc")), (snapshot) => {
        const container = document.getElementById('rides-container');
        const loadMore = document.getElementById('load-more-btn');
        container.innerHTML = '';
        let docs = snapshot.docs;
        let visibleDocs = showAllRides ? docs : docs.slice(0, 3);
        
        visibleDocs.forEach((doc) => {
            const data = doc.data();
            const isJoined = data.participants.includes(currentUsername);
            container.innerHTML += `
                <div class="ride-item">
                    <b>${data.title}</b><br>
                    <small>📍 ${data.start} | 📅 ${data.date}</small>
                    <div style="font-size:0.85rem; margin:8px 0; color:#666;"><b>Συμμετέχοντες:</b> ${data.participants.join(', ')}</div>
                    ${isJoined ? 
                        `<button class="btn-danger" onclick="window.leaveRide('${doc.id}')">Ακύρωση</button>` 
                      : `<button onclick="window.joinRide('${doc.id}')">Συμμετοχή</button>`}
                </div>`;
        });
        loadMore.style.display = (!showAllRides && docs.length > 3) ? 'block' : 'none';
    });
}

function saveModalUsername() {
    const val = document.getElementById('modal-username-input').value.trim();
    if (val) { localStorage.setItem('bikehub_username', val); location.reload(); }
}

function sendChatMessage() {
    const input = document.getElementById('chat-text');
    if (input.value.trim()) { addDoc(collection(db, "chats"), { user: currentUsername, text: input.value, timestamp: Date.now() }); input.value = ''; }
}

function initRealtimeChat() {
    onSnapshot(query(collection(db, "chats"), orderBy("timestamp", "asc")), (snapshot) => {
        const chatBox = document.getElementById('chat-box');
        chatBox.innerHTML = snapshot.docs.map(d => `<div><b>${d.data().user}:</b> ${d.data().text}</div>`).join('');
        chatBox.scrollTop = chatBox.scrollHeight;
    });
}

function updateShareLinks() {
    const url = window.location.href;
    document.getElementById('whatsapp-link').href = `https://api.whatsapp.com/send?text=Έλα στο BikeHub: ${url}`;
}
