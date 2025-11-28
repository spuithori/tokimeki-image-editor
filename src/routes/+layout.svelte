<script lang="ts">
  import '$lib/i18n';
  import { isLoading } from 'svelte-i18n';
</script>

{#if $isLoading}
  <div>Loading...</div>
{:else}
  <slot />
{/if}
