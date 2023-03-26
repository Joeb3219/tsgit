import { program } from 'commander';
import { GitObject } from './common/GitObject';

program
    .command('cat-file')
    .option('-t', 'show object type')
    .option('-s', `show object size`)
    .option('-e', `exit with zero when there's no error`)
    .option('-p', `pretty-print object's content`)
    .argument('<object>')
    .action(async (hash, flags) => {
        const object = await GitObject.readObjectFromDisk(hash);

        if (!flags.t && !flags.p && !flags.s && !flags.e) {
            throw new Error('Please specify output mode')
        }

        if (flags.t) {
            console.log(object.type);
            return;
        }

        if (flags.p) {
            console.log(object.data);
            return;
        }

        if (flags.s) {
            console.log(object.size);
            return;
        }

        if (flags.e) {
            return;
        }

    })

program.parse();