<script lang="ts">
  import { onMount } from 'svelte';

  let {
    repo,
    repoId,
    category = '',
    categoryId = '',
    mapping = 'pathname',
    term = '',
    reactionsEnabled = '1',
    emitMetadata = '0',
    inputPosition = 'bottom',
    theme = 'preferred_color_scheme',
    lang = 'en',
  }: {
    repo: string;
    repoId: string;
    category?: string;
    categoryId?: string;
    mapping?: string;
    term?: string;
    reactionsEnabled?: string;
    emitMetadata?: string;
    inputPosition?: string;
    theme?: string;
    lang?: string;
  } = $props();

  let container: HTMLElement | undefined = $state();
  let mounted = $state(false);

  $effect(() => {
    if (!mounted || !container) return;

    // Check if required props are provided
    if (!repo || !repoId || !categoryId) {
      container.innerHTML =
        '<div style="padding: 1rem; color: #94a3b8; text-align: center; border: 1px dashed rgba(148, 163, 184, 0.3); border-radius: 8px;">Giscus configuration is missing. Please configure repo, repoId, and categoryId.</div>';
      return;
    }

    container.innerHTML = '';

    const script = document.createElement('script');
    script.src = 'https://giscus.app/client.js';
    script.setAttribute('data-repo', repo);
    script.setAttribute('data-repo-id', repoId);
    if (category) script.setAttribute('data-category', category);
    script.setAttribute('data-category-id', categoryId);
    script.setAttribute('data-mapping', mapping);
    if (term) script.setAttribute('data-term', term);
    script.setAttribute('data-reactions-enabled', reactionsEnabled);
    script.setAttribute('data-emit-metadata', emitMetadata);
    script.setAttribute('data-input-position', inputPosition);
    script.setAttribute('data-theme', theme);
    script.setAttribute('data-lang', lang);
    script.crossOrigin = 'anonymous';
    script.async = true;

    container.appendChild(script);
  });

  onMount(() => {
    mounted = true;
  });
</script>

<div bind:this={container} class="giscus-local-wrapper"></div>

<style>
  .giscus-local-wrapper {
    width: 100%;
    min-height: 150px;
  }
</style>
