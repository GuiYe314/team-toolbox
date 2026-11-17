<template>
    <component :is="multiple ? MultiSelect : Select" ref="control" v-bind="$attrs" class="ui-choice"
        :model-value="value" :options="options" option-label="label" option-value="value" option-disabled="disabled"
        :input-id="inputId" :aria-label="ariaLabel" :disabled="disabled" :filter="filter" :placeholder="placeholder"
        :filter-placeholder="filterPlaceholder"
        :show-toggle-all="false" :max-selected-labels="2" selected-items-label="已选择 {0} 项"
        :auto-option-focus="true" :select-on-focus="false" :reset-filter-on-hide="true" append-to="body"
        :pt="{ overlay: { class: 'ui-choice-overlay', 'data-click-feedback': 'off' }, pcFilter: { root: { 'aria-label': filterPlaceholder } } }" @update:model-value="update">
        <template #dropdownicon><svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg></template>
        <template #filtericon><svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></svg></template>
        <template #option="{ option, selected }"><span class="ui-choice-option-label" :data-option-value="String(option.value)">{{ option.label }}</span><svg v-if="selected" class="icon icon-sm ui-choice-check" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg></template>
        <template #optioncheckboxicon="{ checked }"><svg v-if="checked" class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg></template>
    </component>
</template>
<script setup>
import { nextTick, shallowRef, watch } from 'vue';
import Select from 'primevue/select';
import MultiSelect from 'primevue/multiselect';
defineOptions({ inheritAttrs: false });
const props = defineProps({ modelValue: [String, Number, Array], options: { type: Array, default: () => [] }, inputId: String, ariaLabel: String, disabled: Boolean, multiple: Boolean, filter: Boolean, placeholder: { type: String, default: '请选择' }, filterPlaceholder: { type: String, default: '搜索选项' } });
const emit = defineEmits(['update:modelValue']), value = shallowRef(props.modelValue), control = shallowRef(null);
watch(() => props.modelValue, next => { value.value = next; });
async function update(next) {
    value.value = next; emit('update:modelValue', next);
    // 业务确认可能拒绝切换；确保控件回显父级认可的值，保留焦点和多选菜单。
    await nextTick(); value.value = props.modelValue;
}
</script>
