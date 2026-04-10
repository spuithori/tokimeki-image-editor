<script lang="ts">
  import '$lib/i18n';
  import { isLoading } from 'svelte-i18n';
</script>

{#if $isLoading}
  <div class="boot">
    <div class="boot-pulse"></div>
    <span>TOKIMEKI</span>
  </div>
{:else}
  <slot />
{/if}

<style lang="postcss">
  .boot {
    position: fixed;
    inset: 0;
    display: grid;
    place-items: center;
    grid-auto-flow: row;
    gap: 1.25rem;
    background: #050507;
    color: rgba(245, 245, 247, 0.85);
    font-family: sans-serif;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
  }
  .boot-pulse {
    width: 36px;
    height: 36px;
    border-radius: 999px;
    background: radial-gradient(circle, rgba(10, 132, 255, 0.7) 0%, rgba(10, 132, 255, 0) 70%);
    animation: pulse 1.4s cubic-bezier(0.4, 0, 0.2, 1) infinite;
  }
  @keyframes pulse {
    0%,
    100% {
      transform: scale(0.9);
      opacity: 0.5;
    }
    50% {
      transform: scale(1.15);
      opacity: 1;
    }
  }
</style>
