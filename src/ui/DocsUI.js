/**
 * DocsUI.js
 * Manages the UI for the documentation viewer.
 */
(function () {
    document.addEventListener('DOMContentLoaded', () => {
        const showDocsBtn = document.getElementById('show-docs-button');
        const docsDialog = document.getElementById('docs-dialog');
        const closeDocsBtn = document.getElementById('close-docs-button');

        if (showDocsBtn && docsDialog) {
            showDocsBtn.addEventListener('click', () => {
                docsDialog.showModal();
                // Load docs content if not already loaded (handled via docs.js)
                if (window.docs) {
                    const pre = docsDialog.querySelector('pre');
                    if (pre) pre.textContent = window.docs;
                }
            });
        }

        if (closeDocsBtn && docsDialog) {
            closeDocsBtn.addEventListener('click', () => docsDialog.close());
        }

        // Close on backdrop click
        if (docsDialog) {
            docsDialog.addEventListener('click', (e) => {
                if (e.target === docsDialog) docsDialog.close();
            });
        }
    });
})();
