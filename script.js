let currentUsername = "";

window.addEventListener('DOMContentLoaded', () => {
    const savedUser = localStorage.getItem('bikehub_username');
    if (savedUser) {
        currentUsername = savedUser;
        document.getElementById('name-modal').style.display = 'none';
        document.getElementById('display-username').innerText = currentUsername;
    }
    updateShareLinks();
});

function saveModalUsername() {
    const inputVal = document.getElementById('modal-username-input').value.trim();
    if (!inputVal) {
        alert("Παρακαλώ εισάγετε ένα έγκυρο όνομα.");
        return;
    }
    currentUsername = inputVal;
    localStorage.setItem('bikehub_username', currentUsername);
    document.getElementById('name-modal').style.display = 'none';
    document.getElementById('display-username').innerText = currentUsername;
}

function sendChatMessage() {
    const input = document.getElementById('chat-text');
    const text = input.value.trim();
    if(!text) return;
    
    const chatBox = document.getElementById('chat-box');
    chatBox.innerHTML += `<div><b>${currentUsername}:</b> ${escapeHtml(text)}</div>`;
    chatBox.scrollTop = chatBox.scrollHeight;
    input.value = '';
}

function checkEnter(e) {
    if(e.key === 'Enter') sendChatMessage();
}

function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

document.getElementById('drop-zone').addEventListener('click', () => {
    document.getElementById('real-file-input').click();
});

document.getElementById('real-file-input').addEventListener('change', function(e) {
    const reader = new FileReader();
    reader.onload = function(event) {
        const img = document.getElementById('uploaded-map-img');
        img.src = event.target.result;
        img.style.display = 'block';
    }
    if (e.target.files[0]) {
        reader.readAsDataURL(e.target.files[0]);
    }
});

function updateShareLinks() {
    const shareText = "Έλα στην ποδηλατική μας παρέα στο BikeHub! Δες διαδρομές και δήλωσε συμμετοχή.";
    const shareUrl = window.location.href;
    const whatsapp = document.getElementById('whatsapp-link');
    const email = document.getElementById('email-link');
    
    if(whatsapp) whatsapp.href = `https://api.whatsapp.com/send?text=${encodeURIComponent(shareText + ' ' + shareUrl)}`;
    if(email) email.href = `mailto:?subject=${encodeURIComponent("Πρόσκληση στο BikeHub")}&body=${encodeURIComponent(shareText + '\n\n' + shareUrl)}`;
}

function sendEmailInvite() {
    const emailInput = document.getElementById('invite-email').value;
    if(!emailInput) {
        alert("Παρακαλώ εισάγετε ένα e-mail.");
        return;
    }
    const shareText = "Έλα στην ποδηλατική μας παρέα στο BikeHub!";
    const shareUrl = window.location.href;
    window.location.href = `mailto:${emailInput}?subject=${encodeURIComponent("Πρόσκληση στο BikeHub")}&body=${encodeURIComponent(shareText + '\n\n' + shareUrl)}`;
}

let rides = [];
function addNewRide() {
    const title = document.getElementById('ride-title').value.trim();
    const dateInput = document.getElementById('ride-date').value;
    const container = document.getElementById('rides-container');
    
    if (!title || !dateInput) {
        alert("Συμπληρώστε τίτλο και ημερομηνία για τη βόλτα.");
        return;
    }

    rides.push({ title, date: dateInput.replace('T', ' ') });
    renderRides();
    
    document.getElementById('ride-title').value = '';
    document.getElementById('ride-date').value = '';
}

function renderRides() {
    const container = document.getElementById('rides-container');
    container.innerHTML = '';
    rides.forEach((ride, index) => {
        container.innerHTML += `
            <div style="background:#f9f9f9; padding:10px; border-radius:8px; margin-top:8px; border:1px solid #eee;">
                <b>${escapeHtml(ride.title)}</b><br>
                <small>📅 ${ride.date}</small><br>
                <button onclick="joinRide(${index})" style="padding:6px 12px; font-size:0.85rem; margin-top:6px; width:auto;">Συμμετοχή</button>
            </div>
        `;
    });
}

function joinRide(index) {
    alert(`Δηλώσατε συμμετοχή στη βόλτα: "${rides[index].title}"!`);
}
