/* Actual Draft workspace and AppNav, with only fixture navigation/Group providers. */
const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module'),ts=require('typescript');
const root=path.resolve(__dirname,'../..');
module.exports=function(){
  const sources={},maps={};
  const special={
    'next/navigation':`exports.usePathname=()=>location.pathname;exports.useSearchParams=()=>new URLSearchParams(location.search);exports.useRouter=()=>({push:()=>{},replace:()=>{},refresh:()=>{}});`,
    'next/link':`const React=require('react');exports.__esModule=true;exports.default=props=>React.createElement('a',props);`,
    '@/components/providers/GroupProvider':`exports.useGroupContext=()=>window.fixtureGroup;`,
    '@/components/providers/SportProvider':`exports.useSelectedSport=()=>({selectedSport:'nfl',setSelectedSport:()=>{}});`,
  };
  const previous=[require.extensions['.ts'],require.extensions['.tsx']];require.extensions['.ts']??=()=>{};require.extensions['.tsx']??=()=>{};
  function add(file,supplied){
    if(sources[file])return file;let code=supplied??fs.readFileSync(file,'utf8');
    if(/\.tsx?$/.test(file))code=ts.transpileModule(code,{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
    sources[file]=code;maps[file]={};
    for(const match of code.matchAll(/require\(["']([^"']+)["']\)/g)){
      const name=match[1];if(name.endsWith('.development.js'))continue;
      maps[file][name]=special[name]?add(path.join(root,`virtual-draft-${name.replaceAll('/','-')}.js`),special[name]):add(createRequire(file).resolve(name.startsWith('@/')?path.join(root,name.slice(2)):name));
    }return file;
  }
  try{
    const builder=add(path.join(root,'components/lineups/LineupBuilder.tsx')),nav=add(path.join(root,'components/AppNav.tsx'));
    const react=add(require.resolve('react')),client=add(require.resolve('react-dom/client'));
    return `const process={env:{NODE_ENV:'production'}},global=globalThis;const sources=${JSON.stringify(sources)},maps=${JSON.stringify(maps)},cache={};
      function load(id){if(cache[id])return cache[id].exports;const m=cache[id]={exports:{}};new Function('require','module','exports',sources[id])(name=>load(maps[id][name]),m,m.exports);return m.exports;}
      window.React=load(${JSON.stringify(react)});window.ReactDOMClient=load(${JSON.stringify(client)});window.DraftBuilder=load(${JSON.stringify(builder)}).default;window.AppNav=load(${JSON.stringify(nav)}).default;`;
  }finally{for(const [i,ext]of ['.ts','.tsx'].entries()){if(previous[i])require.extensions[ext]=previous[i];else delete require.extensions[ext];}}
};
