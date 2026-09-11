#!/usr/bin/env node
// plugin-demo contributed verb `demo-hello`: my-flow spawns this script with MY_FLOW_PLUGIN_ROOT set.
const root = process.env.MY_FLOW_PLUGIN_ROOT ?? '(MY_FLOW_PLUGIN_ROOT unset)';
console.log(`hello from plugin-demo at ${root}`);
const rest = process.argv.slice(2);
if (rest.length) console.log(rest.join(' '));
process.exit(0);
