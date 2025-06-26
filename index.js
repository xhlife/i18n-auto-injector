import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse as parseSFC } from "@vue/compiler-sfc";
import * as babelParser from "@babel/parser";
import generate from "@babel/generator";
import * as t from "@babel/types";
import traverse from "@babel/traverse";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// === 加载 common.json ===
const commonPath = path.resolve(__dirname, "./common.json");
const commonWords = new Set();
let commonMap = {};

try {
  const content = fsSync.readFileSync(commonPath, "utf-8");
  commonMap = JSON.parse(content);
  Object.keys(commonMap).forEach((key) => {
    commonWords.add(key);
  });
  console.log("✅ 已加载 common.json");
} catch (err) {
  console.warn("⚠️ 读取 common.json 失败", err);
}

// === 工具函数 ===
const localeMap = {};
function addLocale(moduleName, text) {
  const targetModule = commonWords.has(text) ? "common" : moduleName;
  if (!localeMap[targetModule]) {
    localeMap[targetModule] = {};
  }
  if (!localeMap[targetModule][text]) {
    localeMap[targetModule][text] = text;
  }
}

function getTCallExpression(text, moduleName) {
  const targetModule = commonWords.has(text) ? "common" : moduleName;
  return t.callExpression(t.identifier("$t"), [
    t.stringLiteral(`${targetModule}.${text}`),
  ]);
}

function writeLocaleFiles() {
  const outputDir = path.resolve(outDir);
  if (!fsSync.existsSync(outputDir))
    fsSync.mkdirSync(outputDir, { recursive: true });

  for (const [moduleName, map] of Object.entries(localeMap)) {
    const filePath = path.join(outputDir, `${moduleName}.json`);
    const sorted = Object.keys(map)
      .sort()
      .reduce((acc, key) => {
        acc[key] = map[key];
        return acc;
      }, {});
    fsSync.writeFileSync(
      filePath,
      JSON.stringify({ [moduleName]: sorted }, null, 2),
      "utf-8"
    );
  }
}

// === 匹配中文 ===
const zhReg = /[\u4e00-\u9fa5]+/;

function transformBindingExpression(expression, moduleName) {
  try {
    const fakeCode = `const __temp = ${expression};`;
    const ast = babelParser.parse(fakeCode, {
      sourceType: "module",
      plugins: ["typescript"],
    });

    traverse.default(ast, {
      StringLiteral(path) {
        const parent = path.parent;
        const isInsideTCall =
          t.isCallExpression(parent) &&
          t.isIdentifier(parent.callee, { name: "$t" });
        if (!isInsideTCall && zhReg.test(path.node.value)) {
          const value = path.node.value.trim();
          addLocale(moduleName, value);
          path.replaceWith(getTCallExpression(value, moduleName));
        }
      },
    });

    const declaration = ast.program.body[0];
    if (
      t.isVariableDeclaration(declaration) &&
      t.isVariableDeclarator(declaration.declarations[0])
    ) {
      const expr = declaration.declarations[0].init;
      const { code } = generate.default(expr, {
        jsescOption: { quotes: "single", minimal: true },
      });
      if (code.includes("$t(")) return code;

      const newCode = code.replace(
        /([\u4e00-\u9fa5：:，,。！!]+)/g,
        (zhText) => {
          const text = zhText.trim();
          if (!text) return zhText;
          addLocale(moduleName, text);
          const key = commonWords.has(text)
            ? `common.${text}`
            : `${moduleName}.${text}`;
          return `\${$t('${key}')}`;
        }
      );
      return newCode;
    }

    return expression;
  } catch (err) {
    console.warn("❌ 表达式转换失败: ", expression);
    console.warn(err);
    return expression;
  }
}

function transformTemplate(template, moduleName) {
  // 静态属性中的中文
  template = template.replace(
    /(\s)([a-zA-Z0-9\-_:]+)="([^"]*[\u4e00-\u9fa5]+[^"]*)"/g,
    (match, prefixSpace, attrName, attrValue) => {
      const text = attrValue.trim();
      if (!text) return match;

      const isDynamic =
        attrName.startsWith(":") || attrName.startsWith("v-bind");
      if (isDynamic) {
        // 避免重复替换
        if (/\$t\(['"][^'"]+['"]\)/.test(attrValue)) return match;
        const newExpr = transformBindingExpression(attrValue, moduleName);
        return `${prefixSpace}${attrName}="${newExpr}"`;
      }

      // 静态中文属性替换
      addLocale(moduleName, text);
      const key = commonWords.has(text)
        ? `common.${text}`
        : `${moduleName}.${text}`;
      return `${prefixSpace}:${attrName}="$t('${key}')"`; // 转为动态绑定
    }
  );
  // 标签内容文本（跳过 <script>、<style>、注释、表达式）
  template = template.replace(/>([^<]*)</g, (match, inner) => {
    const raw = inner;

    // 跳过注释 <!-- xxx -->、空白、无中文内容
    if (
      /<!--.*-->/.test(raw) ||
      !zhReg.test(raw) ||
      /^\s*$/.test(raw) ||
      raw.includes("$t(")
    ) {
      return match;
    }

    // 拆分 {{}} 与普通中文部分
    const parts = raw.split(/({{.*?}})/g).filter(Boolean);

    const transformed = parts
      .map((part) => {
        if (part.startsWith("{{")) return part;

        // 将纯中文拆出，逐个替换为 {{ $t('...') }}
        return part.replace(/[\u4e00-\u9fa5]+/g, (zh) => {
          addLocale(moduleName, zh);
          const key = commonWords.has(zh)
            ? `common.${zh}`
            : `${moduleName}.${zh}`;
          return `{{ $t('${key}') }}`;
        });
      })
      .join("");

    return `>${transformed}<`;
  });

  // {{ 表达式中的中文（仅字符串） }}
  template = template.replace(/{{([^{}]*)}}/g, (match, expression) => {
    const replaced = expression.replace(
      /(['"])([\u4e00-\u9fa5][^'"]*)\1/g,
      (m, quote, zhText) => {
        addLocale(moduleName, zhText);
        const key = commonWords.has(zhText)
          ? `common.${zhText}`
          : `${moduleName}.${zhText}`;
        return `$t('${key}')`;
      }
    );
    return `{{${replaced}}}`;
  });

  // 标签内容文本（跳过 <script>、<style>、注释、表达式）
  template = template.replace(/>([^<]*)</g, (match, inner) => {
    const raw = inner;

    // 跳过注释 <!-- xxx -->、空白、无中文内容
    if (
      /<!--.*-->/.test(raw) ||
      !zhReg.test(raw) ||
      /^\s*$/.test(raw) ||
      raw.includes("$t(")
    ) {
      return match;
    }

    // 拆分 {{}} 与普通中文部分
    const parts = raw.split(/({{.*?}})/g).filter(Boolean);

    const transformed = parts
      .map((part) => {
        if (part.startsWith("{{")) return part;

        // 将纯中文拆出，逐个替换为 {{ $t('...') }}
        return part.replace(/[\u4e00-\u9fa5]+/g, (zh) => {
          addLocale(moduleName, zh);
          const key = commonWords.has(zh)
            ? `common.${zh}`
            : `${moduleName}.${zh}`;
          return `{{ $t('${key}') }}`;
        });
      })
      .join("");

    return `>${transformed}<`;
  });

  return template;
}

function transformScript(script, moduleName) {
  const ast = babelParser.parse(script, {
    sourceType: "module",
    plugins: ["typescript", "jsx"],
  });

  traverse.default(ast, {
    StringLiteral(path) {
      if (
        path.parentPath.isCallExpression() &&
        path.parent.callee.name === "$t"
      )
        return;
      if (zhReg.test(path.node.value)) {
        const text = path.node.value.trim();
        addLocale(moduleName, text);
        path.replaceWith(getTCallExpression(text, moduleName));
      }
    },

    TemplateLiteral(path) {
      if (path.node.__i18nTransformed) return;
      
      const { quasis, expressions } = path.node;
      let hasChinese = quasis.some(q => zhReg.test(q.value.raw));
      if (!hasChinese) return;
    
      const newQuasis = [];
      const newExpressions = [];
      let pendingQuasi = '';
    
      const flushPendingQuasi = () => {
        if (pendingQuasi) {
          newQuasis.push(t.templateElement({ 
            raw: pendingQuasi, 
            cooked: pendingQuasi 
          }, false));
          pendingQuasi = '';
        }
      };
    
      for (let i = 0; i < quasis.length; i++) {
        const quasi = quasis[i];
        const text = quasi.value.raw;
        
        // 分割中文和非中文部分
        const segments = text.split(/([\u4e00-\u9fa5]+)/).filter(Boolean);
        
        segments.forEach(segment => {
          if (zhReg.test(segment)) {
            flushPendingQuasi();
            addLocale(moduleName, segment);
            newExpressions.push(getTCallExpression(segment, moduleName));
            newQuasis.push(t.templateElement({ raw: '', cooked: '' }, false));
          } else {
            pendingQuasi += segment;
          }
        });
    
        flushPendingQuasi();
    
        // 处理原始表达式
        if (i < expressions.length) {
          newExpressions.push(expressions[i]);
          newQuasis.push(t.templateElement({ raw: '', cooked: '' }, false));
        }
      }
    
      // 确保最后一个quasi是tail
      if (newQuasis.length > 0) {
        const last = newQuasis[newQuasis.length - 1];
        newQuasis[newQuasis.length - 1] = t.templateElement(
          last.value, 
          true
        );
      }
    
      // 确保quasis比expressions多一个
      while (newQuasis.length <= newExpressions.length) {
        newQuasis.push(t.templateElement({ raw: '', cooked: '' }, false));
      }
    
      const newNode = t.templateLiteral(newQuasis, newExpressions);
      newNode.__i18nTransformed = true;
      path.replaceWith(newNode);
    },

    JSXText(path) {
      const raw = path.node.value;
      if (!zhReg.test(raw)) return;

      const parts = raw.split(/([\u4e00-\u9fa5]+)/).filter(Boolean);
      const nodes = parts.map((part) => {
        if (zhReg.test(part)) {
          const text = part.trim();
          addLocale(moduleName, text);
          const key = commonWords.has(text)
            ? `common.${text}`
            : `${moduleName}.${text}`;
          return t.jsxExpressionContainer(getTCallExpression(text, moduleName));
        } else {
          return t.jsxText(part);
        }
      });

      // 替换当前 JSXText 为多个节点
      path.replaceWithMultiple(nodes);
    },
  });

  return generate.default(ast, { jsescOption: { minimal: true } }, script).code;
}

// === Vue 文件处理 ===
async function processVueFile(srcPath, moduleName, outPath) {
  const content = await fs.readFile(srcPath, "utf-8");
  const { descriptor } = parseSFC(content);

  const template = descriptor.template?.content || "";
  const script = descriptor.scriptSetup?.content || "";
  const styles = descriptor.styles || [];

  const newTemplate = template ? transformTemplate(template, moduleName) : "";
  const newScript = script ? transformScript(script, moduleName) : "";

  const newContent = `
<script setup lang="ts">
${newScript}
</script>
<template>
${newTemplate}
</template>
${styles
  .map((style) => {
    return `<style${style.scoped ? " scoped" : ""}${
      style.lang ? ` lang="${style.lang}"` : ""
    }>
${style.content}
</style>`;
  })
  .join("\n")}
`.trim();

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, newContent, "utf-8");
  console.log(`✅ Vue文件转换成功: ${srcPath} => ${outPath}`);
}

async function processTsFile(srcPath, moduleName, outPath) {
  const code = await fs.readFile(srcPath, "utf-8");
  const newCode = transformScript(code, moduleName);
  const fileType = path.extname(srcPath).split(".")[1];

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, newCode, "utf-8");
  console.log(`✅ ${fileType}文件转换成功: ${srcPath} => ${outPath}`);
}

async function walkDir(srcDir, moduleName, outDir) {
  const entries = await fs.readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const outPath = path.join(outDir, entry.name);
    if (entry.isDirectory()) {
      await walkDir(srcPath, moduleName, outPath);
    } else if (entry.isFile()) {
      if (entry.name.endsWith(".vue")) {
        await processVueFile(srcPath, moduleName, outPath);
      } else if (
        entry.name.endsWith(".ts") ||
        entry.name.endsWith(".tsx") ||
        entry.name.endsWith(".jsx")
      ) {
        await processTsFile(srcPath, moduleName, outPath);
      }
    }
  }
}

// === 执行入口 ===
const srcDir = path.resolve(__dirname, "./testFile"); // 输入路径
const outDir = path.resolve(__dirname, "./testResult"); // 输出路径
const moduleName = "test"; // 模块名称

walkDir(srcDir, moduleName, outDir)
  .then(() => {
    console.log("✅ 国际化替换完成");
    writeLocaleFiles();
  })
  .catch(console.error);