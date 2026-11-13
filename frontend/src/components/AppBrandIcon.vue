<template>
    <img :src="icon.image" :data-app-icon-id="icon.id" alt="" aria-hidden="true" @error="reportAppIconError(icon.id)" />
</template>

<script>
import { displayedAppIcon, reportAppIconError } from '../stores/app-icon.js';

export default {
    name: 'AppBrandIcon',
    computed: { icon: displayedAppIcon },
    methods: { reportAppIconError }
};
</script>
