<script lang="ts">
  import { ImageEditor } from '$lib';

  function handleExport(dataUrl: string) {
    console.log('Image exported:', dataUrl.substring(0, 50) + '...');
  }
</script>

<svelte:head>
  <title>TOKIMEKI Image Editor - Demo</title>
</svelte:head>

<main>
  <div class="container">
    <header>
      <h1>TOKIMEKI Image Editor</h1>
    </header>

    <div class="demo-section">
      <ImageEditor
        width={1000}
        height={600}
        isStandalone={true}
        onExport={handleExport}
      />
    </div>
  </div>
</main>

<style lang="postcss">
  :global(body) {
    margin: 0;
    padding: 0;
    font-family: sans-serif;
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
    font-size: 3rem;
    margin: 0;
    background: linear-gradient(135deg, #66b7ea 0%, #e07eed 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .demo-section {
    display: flex;
    justify-content: center;
  }
</style>
