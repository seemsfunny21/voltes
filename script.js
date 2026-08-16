// Λογική για το Chat
function sendChatMessage() {
    const input = document.getElementById('chat-text');
    if(!input.value) return;
    const chatBox = document.getElementById('chat-box');
    chatBox.innerHTML += `<div><b>Εσύ:</b> ${input.value}</div>`;
    input.value = '';
}

// Λογική για την ανέβαστη φωτογραφίας
document.getElementById('drop-zone').addEventListener('click', () => {
    document.getElementById('real-file-input').click();
});

document.getElementById('real-file-input').addEventListener('change', function(e) {
    const reader = new FileReader();
    reader.onload = function(event) {
        document.getElementById('uploaded-map-img').src = event.target.result;
    }
    reader.readAsDataURL(e.target.files[0]);
});

// Λογική για τις βόλτες
function addNewRide() {
    const title = document.getElementById('ride-title').value;
    const container = document.getElementById('rides-container');
    if (title) {
        container.innerHTML += `<div class="card"><b>${title}</b><br><button>Συμμετοχή</button></div>`;
        document.getElementById('ride-title').value = '';
    }
}
