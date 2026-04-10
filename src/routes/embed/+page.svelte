<script lang="ts">
  import { ImageEditor } from '$lib';
  import { Pencil, Image as ImageIcon, RefreshCw } from 'lucide-svelte';

  let showEditor = $state(false);
  let selectedFile = $state<File | null>(null);
  let editedImageUrl = $state<string | null>(null);
  let fileInput: HTMLInputElement;

  function handleFileSelect(event: Event) {
    const target = event.target as HTMLInputElement;
    if (target.files && target.files[0]) {
      selectedFile = target.files[0];
      editedImageUrl = null;
    }
  }

  function handleEdit() {
    if (selectedFile || editedImageUrl) {
      showEditor = true;
    }
  }

  function handleComplete(
    dataUrl: string,
    blobObj: { blob: Blob; width: number; height: number }
  ) {
    console.log(blobObj);
    editedImageUrl = dataUrl;
    showEditor = false;
  }

  function handleCancel() {
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
  <title>Embedded Mode — TOKIMEKI Image Editor</title>
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
</svelte:head>

{#if !showEditor}
  <main>
    <div class="container">
      <header>
        <span class="kicker">Embed mode</span>
        <h1>Drop the editor inside any flow</h1>
        <p class="lede">
          Use the editor as an inline modal. Pick an image, fine-tune it, then receive a
          base64 / Blob payload back to your app.
        </p>
      </header>

      <section class="content">
        {#if hasImage}
          <div class="image-card">
            <img src={displayImageUrl} alt="Preview" />
            {#if isEdited}
              <div class="edited-badge">
                <span class="dot"></span>
                Edited
              </div>
            {/if}
          </div>

          <div class="actions">
            <button class="btn btn-primary" onclick={handleEdit}>
              <Pencil size={16} strokeWidth={2.4} />
              Edit Image
            </button>
            <button class="btn btn-secondary" onclick={openFileDialog}>
              <RefreshCw size={16} strokeWidth={2.4} />
              Choose another
            </button>
          </div>
        {:else}
          <button class="upload-prompt" onclick={openFileDialog} type="button">
            <div class="upload-icon">
              <ImageIcon size={28} strokeWidth={1.6} />
            </div>
            <h2>Pick an image to begin</h2>
            <p>PNG · JPEG · WebP — up to ~30MB</p>
          </button>
        {/if}

        <input
          bind:this={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/jpg,image/webp"
          onchange={handleFileSelect}
          hidden
        />
      </section>
    </div>
  </main>
{:else}
  <div class="editor-overlay">
    <div class="editor-frame">
      <ImageEditor
        initialImage={imageToEdit}
        width={1200}
        height={700}
        isStandalone={false}
        onComplete={handleComplete}
        onCancel={handleCancel}
      />
    </div>
  </div>
{/if}

<style lang="postcss">
  :global(body) {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Hiragino Sans',
      'Yu Gothic UI', 'Segoe UI', Roboto, sans-serif;
    background: #050507;
    color: #f5f5f7;
    -webkit-font-smoothing: antialiased;
  }
  :global(html) {
    background: #050507;
  }

  main {
    min-height: 100dvh;
    padding: 4rem 1.5rem;
    background:
      radial-gradient(ellipse at 20% 0%, rgba(102, 183, 234, 0.08), transparent 60%),
      radial-gradient(ellipse at 80% 100%, rgba(224, 126, 237, 0.08), transparent 60%),
      #050507;
  }

  .container {
    max-width: 720px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 3rem;
  }

  header {
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    align-items: center;
  }

  .kicker {
    display: inline-block;
    padding: 4px 12px;
    background: rgba(10, 132, 255, 0.12);
    color: #409cff;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  h1 {
    margin: 0;
    font-size: clamp(28px, 5vw, 44px);
    font-weight: 700;
    letter-spacing: -0.025em;
    color: #f5f5f7;
    line-height: 1.1;
  }

  .lede {
    margin: 0;
    max-width: 480px;
    color: rgba(245, 245, 247, 0.6);
    font-size: 15px;
    line-height: 1.6;
  }

  .content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2rem;
  }

  .image-card {
    position: relative;
    width: 100%;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 24px;
    padding: 12px;
    box-shadow: 0 24px 60px -16px rgba(0, 0, 0, 0.7);
  }
  .image-card img {
    width: 100%;
    height: auto;
    display: block;
    border-radius: 16px;
  }

  .edited-badge {
    position: absolute;
    top: 1.25rem;
    right: 1.25rem;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background: rgba(10, 132, 255, 0.18);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    color: #409cff;
    border: 1px solid rgba(10, 132, 255, 0.4);
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: #0a84ff;
    box-shadow: 0 0 6px rgba(10, 132, 255, 0.6);
  }

  .upload-prompt {
    appearance: none;
    width: 100%;
    background: rgba(255, 255, 255, 0.03);
    border: 1.5px dashed rgba(255, 255, 255, 0.18);
    border-radius: 24px;
    padding: 4rem 2rem;
    text-align: center;
    cursor: pointer;
    color: #f5f5f7;
    transition:
      border-color 220ms cubic-bezier(0.16, 1, 0.3, 1),
      background 220ms cubic-bezier(0.16, 1, 0.3, 1),
      transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
  }
  .upload-prompt:hover {
    border-color: rgba(10, 132, 255, 0.5);
    background: rgba(10, 132, 255, 0.06);
  }
  .upload-prompt:active {
    transform: scale(0.98);
  }

  .upload-icon {
    width: 64px;
    height: 64px;
    border-radius: 20px;
    background: rgba(10, 132, 255, 0.12);
    color: #409cff;
    display: grid;
    place-items: center;
    margin-bottom: 0.5rem;
  }

  .upload-prompt h2 {
    margin: 0;
    font-size: 17px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .upload-prompt p {
    margin: 0;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(245, 245, 247, 0.45);
  }

  .actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    justify-content: center;
  }

  .btn {
    appearance: none;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 0 1.5rem;
    height: 44px;
    border: none;
    border-radius: 999px;
    font-family: inherit;
    font-size: 14px;
    font-weight: 600;
    letter-spacing: -0.01em;
    cursor: pointer;
    transition:
      transform 140ms cubic-bezier(0.34, 1.56, 0.64, 1),
      background 140ms cubic-bezier(0.16, 1, 0.3, 1);
    -webkit-tap-highlight-color: transparent;
  }
  .btn-primary {
    background: #0a84ff;
    color: #fff;
    box-shadow: 0 4px 16px rgba(10, 132, 255, 0.32);
  }
  .btn-primary:hover {
    background: #409cff;
  }
  .btn-secondary {
    background: rgba(255, 255, 255, 0.06);
    color: rgba(245, 245, 247, 0.85);
    border: 1px solid rgba(255, 255, 255, 0.1);
  }
  .btn-secondary:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #f5f5f7;
  }
  .btn:active {
    transform: scale(0.96);
  }

  .editor-overlay {
    position: fixed;
    inset: 0;
    background: rgba(5, 5, 7, 0.9);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    z-index: 9999;
    display: grid;
    place-items: center;
    padding: 1.5rem;
    box-sizing: border-box;
    animation: fade-in 280ms cubic-bezier(0.16, 1, 0.3, 1);
  }
  @keyframes fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  .editor-frame {
    width: min(1240px, 100%);
    height: min(800px, 100%);
    display: flex;
    align-items: stretch;
    justify-content: center;
  }
  .editor-frame > :global(*) {
    width: 100%;
    height: 100%;
  }

  @media (max-width: 767px) {
    main {
      padding: 2.5rem 1rem;
    }
    .container {
      gap: 2rem;
    }
    .editor-overlay {
      padding: 0;
    }
  }
</style>
