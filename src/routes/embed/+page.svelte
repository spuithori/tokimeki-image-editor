<script lang="ts">
  import { ImageEditor } from '$lib';

  let showEditor = $state(false);
  let selectedFile = $state<File | null>(null);
  let editedImageUrl = $state<string | null>(null);
  let fileInput: HTMLInputElement;

  function handleFileSelect(event: Event) {
    const target = event.target as HTMLInputElement;
    if (target.files && target.files[0]) {
      selectedFile = target.files[0];
      editedImageUrl = null; // Reset edited image when new file is selected
    }
  }

  function handleEdit() {
    if (selectedFile || editedImageUrl) {
      showEditor = true;
    }
  }

  function handleComplete(dataUrl: string, blob: Blob) {
    console.log('Image edited successfully');
    console.log('Data URL length:', dataUrl.length);
    console.log('Blob size:', blob.size, 'bytes');
    editedImageUrl = dataUrl;
    showEditor = false;
  }

  function handleCancel() {
    console.log('Edit cancelled');
    showEditor = false;
  }

  function openFileDialog() {
    fileInput?.click();
  }

  const displayImageUrl = $derived.by(() => {
    if (editedImageUrl) return editedImageUrl;
    if (selectedFile) return URL.createObjectURL(selectedFile);
    return null;
  });

  const imageToEdit = $derived.by(() => {
    if (editedImageUrl) return editedImageUrl;
    if (selectedFile) return selectedFile;
    return null;
  });

  const hasImage = $derived(!!displayImageUrl);
  const isEdited = $derived(!!editedImageUrl);
</script>

<svelte:head>
  <title>Embedded Mode Test - Tokimeki Image Editor</title>
</svelte:head>

{#if !showEditor}
  <main>
    <div class="container">
      <header>
        <h1>Tokimeki Image Editor (Embed)</h1>
      </header>

      <div class="content">
        {#if hasImage}
          <div class="image-preview">
            <img src={displayImageUrl} alt="Preview" />
            {#if isEdited}
              <div class="edited-badge">Edited</div>
            {/if}
          </div>

          <div class="actions">
            <button class="btn btn-primary" onclick={handleEdit}>
              Edit Image
            </button>
            <button class="btn btn-secondary" onclick={openFileDialog}>
              Select Different Image
            </button>
          </div>
        {:else}
          <div class="upload-prompt">
            <div class="upload-icon">🖼️</div>
            <p>No image selected</p>
            <button class="btn btn-primary" onclick={openFileDialog}>
              Select Image
            </button>
          </div>
        {/if}

        <input
          bind:this={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/jpg"
          onchange={handleFileSelect}
          style="display: none;"
        />
      </div>
    </div>
  </main>
{:else}
  <div class="editor-overlay">
    <ImageEditor
      initialImage={imageToEdit}
      width={1200}
      height={700}
      isStandalone={false}
      onComplete={handleComplete}
      onCancel={handleCancel}
    />
  </div>
{/if}

<style lang="postcss">
  :global(body) {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    background: #0a0a0a;
    color: #fff;
  }

  main {
    min-height: 100vh;
    padding: 2rem;
  }

  .container {
    max-width: 1200px;
    margin: 0 auto;
  }

  header {
    text-align: center;
    margin-bottom: 3rem;
  }

  h1 {
    font-size: 2.5rem;
    margin: 0 0 0.5rem 0;
    background: linear-gradient(135deg, #66b7ea 0%, #e07eed 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2rem;
    margin-bottom: 3rem;
  }

  .image-preview {
    position: relative;
    max-width: 800px;
    width: 100%;
    background: #1a1a1a;
    border-radius: 12px;
    padding: 1rem;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  }

  .image-preview img {
    width: 100%;
    height: auto;
    display: block;
    border-radius: 8px;
  }

  .edited-badge {
    position: absolute;
    top: 2rem;
    right: 2rem;
    background: var(--primary-color, #63b97b);
    color: #fff;
    padding: 0.5rem 1rem;
    border-radius: 20px;
    font-size: 0.9rem;
    font-weight: 600;
    box-shadow: 0 4px 12px rgba(0, 102, 204, 0.4);
  }

  .upload-prompt {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 400px;
    padding: 3rem;
    background: #1a1a1a;
    border: 2px dashed #444;
    border-radius: 12px;
    text-align: center;
  }

  .upload-icon {
    font-size: 4rem;
    margin-bottom: 1rem;
    opacity: 0.5;
  }

  .upload-prompt p {
    margin: 0 0 2rem 0;
    font-size: 1.2rem;
    color: #999;
  }

  .actions {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
    justify-content: center;
  }

  .btn {
    padding: 0.75rem 2rem;
    border: none;
    border-radius: 8px;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }

  .btn-primary {
    background: var(--primary-color, #63b97b);
    color: #fff;
  }

  .btn-secondary {
    background: #333;
    color: #fff;
    border: 1px solid #555;
  }

  .editor-overlay {
    position: fixed;
    inset: 0;
    background: #0a0a0a;
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    box-sizing: border-box;
  }
</style>
