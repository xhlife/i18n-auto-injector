<script setup lang="ts">
const isTrue = ref(false);
// const s = `测试`;
const showTime = computed(() => {
  const m = Math.floor(restTime.value / 60);
  const s = restTime.value % 60;
  const res = `${m}分${s}秒`;
  return res;
});
const t = `测试${isTrue.value ? "好的" : "坏的"}` + "好了";
const a = {
  name: `${passScore + gap * i}分以上`,
  name2: `${passScore + gap * i}分-${passScore + gap * (i + 1)}分`
};
</script>

<template>
  <div>
    <el-progress :text="avgScore > passScore ? '测试1' : '测试2'"></el-progress>
    <el-text
      tag="b"
      style="font-size: 2rem"
      :text0="'测试0'"
      :text1="'测试1:'"
      :text2="`测试2测试2`"
      text3="测试3"
    >
      您的作答：{{ question.answer_answer?.[0] }}
      {{ isTrue ? "真的" : "假的" }}
      不是吧
      {{ isTrue ? "真的" : "假的" }}
    </el-text>
    <div :test="`看看`"></div>
  </div>
</template>

<style scoped></style>