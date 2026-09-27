const editor = document.getElementById('editor');

function hideCursorWhileTyping() {
  editor.addEventListener('keydown', () => document.body.classList.add('typing'));
  document.addEventListener('mousemove', () => document.body.classList.remove('typing'));
}

function autosave() {
  editor.addEventListener('input', () => window.freewriter.textChanged(editor.value));
}

hideCursorWhileTyping();
autosave();
editor.focus();
