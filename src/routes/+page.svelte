<script lang="ts">
  import { ImageEditor } from '$lib';

  function handleExport(dataUrl: string) {
    console.log('Image exported:', dataUrl.substring(0, 50) + '...');
  }
</script>

<svelte:head>
  <title>TOKIMEKI Image Editor — A modern image editor for Svelte 5</title>
  <meta name="description" content="A powerful and modern image editing library for Svelte 5 with WebGPU rendering." />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
</svelte:head>

<main>
  <ImageEditor isStandalone={true} onExport={handleExport} />
</main>

<style lang="postcss">
  :global(body) {
    margin: 0;
    padding: 0;
    font-family: sans-serif;
    background: var(--tk-bg-canvas, #050507);
    color: var(--tk-text-primary, #f5f5f7);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    overscroll-behavior: none;
  }

  :global(html) {
    background: var(--tk-bg-canvas, #050507);
  }

  main {
    position: fixed;
    inset: 0;
    overflow: hidden;
  }
</style>
