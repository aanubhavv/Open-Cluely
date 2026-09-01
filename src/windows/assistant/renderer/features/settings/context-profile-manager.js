export function createContextProfileManager({
  openBtn,
  panel,
  closeBtn,
  saveBtn,
  uploadPdfBtn,
  resumeStatus,
  resumeTextEl,
  strengthsEl,
  weaknessesEl,
  pastExperiencesEl,
  additionalContextEl,
  showFeedback
}) {
  let currentProfile = {};

  async function loadProfile() {
    if (window.electronAPI && window.electronAPI.getContextProfile) {
      currentProfile = await window.electronAPI.getContextProfile();
      resumeTextEl.value = currentProfile.resumeText || '';
      strengthsEl.value = currentProfile.strengths || '';
      weaknessesEl.value = currentProfile.weaknesses || '';
      pastExperiencesEl.value = currentProfile.pastExperiences || '';
      additionalContextEl.value = currentProfile.additionalContext || '';
      
      if (currentProfile.resumeText) {
        resumeStatus.textContent = 'PDF text loaded.';
      } else {
        resumeStatus.textContent = 'No PDF uploaded.';
      }
    }
  }

  async function saveProfile() {
    const payload = {
      resumeText: resumeTextEl.value,
      strengths: strengthsEl.value,
      weaknesses: weaknessesEl.value,
      pastExperiences: pastExperiencesEl.value,
      additionalContext: additionalContextEl.value
    };

    if (window.electronAPI && window.electronAPI.saveContextProfile) {
      const result = await window.electronAPI.saveContextProfile(payload);
      if (result.success) {
        showFeedback('Context profile saved', 'success');
        closePanel();
      } else {
        showFeedback('Error saving context profile', 'error');
      }
    }
  }

  async function handlePdfUpload() {
    if (window.electronAPI && window.electronAPI.selectAndParsePdf) {
      resumeStatus.textContent = 'Selecting and parsing PDF...';
      const result = await window.electronAPI.selectAndParsePdf();
      if (result.canceled) {
        resumeStatus.textContent = resumeTextEl.value ? 'PDF text loaded.' : 'No PDF uploaded.';
        return;
      }
      if (result.success) {
        resumeTextEl.value = result.text;
        resumeStatus.textContent = `Successfully parsed: ${result.filePath}`;
        showFeedback('PDF Parsed Successfully', 'success');
      } else {
        resumeStatus.textContent = 'Error parsing PDF.';
        showFeedback('Error parsing PDF', 'error');
      }
    }
  }

  function openPanel() {
    loadProfile();
    panel.classList.remove('hidden');
  }

  function closePanel() {
    panel.classList.add('hidden');
  }

  // Bind Events
  if (openBtn) openBtn.addEventListener('click', openPanel);
  if (closeBtn) closeBtn.addEventListener('click', closePanel);
  if (saveBtn) saveBtn.addEventListener('click', saveProfile);
  if (uploadPdfBtn) uploadPdfBtn.addEventListener('click', handlePdfUpload);

  return {
    openPanel,
    closePanel,
    loadProfile
  };
}

