<script lang="ts">
  /**
   * Backwards-compatible shim that forwards to the new <Sheet/> primitive.
   * Kept so existing tools (Adjust/Filter/Blur/...) keep their imports.
   */
  import type { Snippet } from 'svelte';
  import Sheet from './Sheet.svelte';

  interface Props {
    title: string;
    onClose: () => void;
    children: Snippet;
    actions?: Snippet;
  }

  let {
    title,
    onClose,
    children: bodySnippet,
    actions: actionsSnippet
  }: Props = $props();
</script>

{#if actionsSnippet}
  <Sheet {title} {onClose}>
    {#snippet children()}
      {@render bodySnippet()}
    {/snippet}
    {#snippet actions()}
      {@render actionsSnippet()}
    {/snippet}
  </Sheet>
{:else}
  <Sheet {title} {onClose}>
    {#snippet children()}
      {@render bodySnippet()}
    {/snippet}
  </Sheet>
{/if}
