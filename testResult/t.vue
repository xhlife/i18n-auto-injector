<script setup lang="ts">
const isTrue = ref(false);
// const s = `测试`;
const showTime = computed(() => {
  const m = Math.floor(restTime.value / 60);
  const s = restTime.value % 60;
  const res = `${m}${$t("test.分")}${s}${$t("test.秒")}`;
  return res;
});
const t = `${$t("test.测试")}${isTrue.value ? $t("test.好的") : $t("test.坏的")}` + $t("test.好了");
const a = {
  name: `${passScore + gap * i}${$t("test.分以上")}`,
  name2: `${passScore + gap * i}${$t("test.分")}-${passScore + gap * (i + 1)}${$t("test.分")}`
};
</script>
<template>

  <div>
    <el-progress :text="avgScore > passScore ? $t('test.测试1') : $t('test.测试2')"></el-progress>
    <el-text
      tag="b"
      style="font-size: 2rem"
      :text0="$t('test.测试0')"
      :text1="$t('test.测试1:')"
      :text2="`${$t('test.测试')}2${$t('test.测试')}2`"
      :text3="$t('test.测试3')"
    >
      {{ $t('test.您的作答') }}：{{ question.answer_answer?.[0] }}
      {{ isTrue ? $t('test.真的') : $t('test.假的') }}
      {{ $t('test.不是吧') }}
      {{ isTrue ? $t('test.真的') : $t('test.假的') }}
    </el-text>
    <div :test="`${$t('test.看看')}`"></div>
  </div>

</template>