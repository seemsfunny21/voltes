import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy, doc, updateDoc, arrayUnion } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

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

let currentUsername = "";

window.addEventListener('DOMContentLoaded', () => {
    const savedUser = localStorage.getItem('bikehub_username');
    if (savedUser) {
        currentUsername = savedUser;
        document.getElementById('name-modal').style.display = 'none';
        document.getElementById('display-username').innerText = "Καλώς ήρθες, " + currentUsername;
    }
    updateShareLinks();
    initRealtimeRides();
    
    document.getElementById('save-name-btn').addEventListener('click', saveModalUsername);
    document.getElementById('add-ride-btn').addEventListener('click', addNewRide);
});

function saveModalUsername() {
    const inputVal = document.getElementById('modal-username-input').value.trim();
    if (!inputVal) { alert("Παρακαλώ εισάγετε ένα έγκυρο όνομα."); return; }
    currentUsername = inputVal;
    localStorage.setItem('bikehub_username', currentUsername);
    document.getElementById('name-modal').style.display = 'none';
    document.getElementById('display-username').innerText = "Καλώς ήρθες, " + currentUsername;
}

window.joinRide = async function(rideId) {
    if (!currentUsername) { alert("Παρακαλώ εισάγετε το όνομά σας πρώτα."); return; }
    try {
        const rideRef = doc(db, "rides", rideId);
        await updateDoc(rideRef, {
            participants: arrayUnion(currentUsername)
        });
    } catch (e) {
        console.error("Σφάλμα συμμετοχής: ", e);
    }
};

async function addNewRide() {
    const title = document.getElementById('ride-title').value.trim();
    const dateInput = document.getElementById('ride-date').value;
    if (!title || !dateInput) { alert("Συμπληρώστε τίτλο και ημερομηνία."); return; }

    try {
        await addDoc(collection(db, "rides"), {
            title: title,
            date: dateInput.replace('T', ' '),
            participants: [currentUsername], 
            timestamp: Date.now()
        });
    } catch (e) { console.error("Σφάλμα δημιουργίας: ", e); }
}

function initRealtimeRides() {
    const q = query(collection(db, "rides"), orderBy("timestamp", "desc"));
    onSnapshot(q, (snapshot) => {
        const container = document.getElementById('rides-container');
        container.innerHTML = '';
        snapshot.forEach((doc) => {
            const ride = doc.data();
            const participantsList = ride.participants ? ride.participants.join(', ') : 'Κανείς ακόμα';
            container.innerHTML += `
                <div style="background:#fff; padding:12px; border-radius:10px; margin-top:10px; border:1px solid #ddd;">
                    <b>${ride.title}</b><br>
                    <small>📅 ${ride.date}</small><br>
                    <div style="margin:8px 0; font-size:0.85rem; color:#333;">
                        <b>Ποιοι πάνε:</b> ${participantsList}
                    </div>
                    <button onclick="window.joinRide('${doc.id}')" style="background:#fc4c02; color:white; border:none; padding:6px 12px; border-radius:4px; cursor:pointer;">Συμμετοχή</button>
                </div>
            `;
        });
    });
}

function updateShareLinks() {
    const shareUrl = window.location.href;
    const msg = "Ελα στην ποδηλατική βόλτα BikeHub!";
    document.getElementById('whatsapp-link').href = `https://api.whatsapp.com/send?text=${encodeURIComponent(msg + ' ' + shareUrl)}`;
    document.getElementById('messenger-link').href = `fb-messenger://share?link=${encodeURIComponent(shareUrl)}`;
    document.getElementById('facebook-link').href = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`;
}
