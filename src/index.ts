#!/usr/bin/env node

import {promises as fs} from "fs"
import {relative} from "path"
import {getDirectories} from "./util"

const packageDir = "packages"

const pick = <Input, Output>(
    input: Input[],
    f: (element: Input) => Output | undefined,
): Output | undefined => input.map(f).find(element => element !== undefined)

const dependencyPathMap = new Map<string, string>()
const getPackageDirectory = async (desiredName: string) => {
    if (dependencyPathMap.has(desiredName)) {
        return dependencyPathMap.get(desiredName)!
    } else {
        const value = pick(
            await Promise.all(
                getDirectories(packageDir).map(async directory => ({
                    directory,
                    ...JSON.parse(
                        (await fs.readFile(
                            `${directory}/package.json`,
                        )).toString(),
                    ),
                })),
            ),
            ({directory, name}: {directory: string; name: string}) =>
                name === desiredName ? directory : undefined,
        )
        if (value === undefined) {
            throw new Error(`Could not find package ${desiredName}`)
        }
        dependencyPathMap.set(desiredName, value)
        return value
    }
}

interface Dependencies {
    [pckg: string]: string
}

interface Dependency {
    name: string
    directory: string
}

interface ProcessedPackages {
    directory: string
    dependencies: Dependency[]
}

const processPackage = async (
    prefix: string,
    directory: string,
    dependencies: Dependencies,
): Promise<ProcessedPackages> => ({
    directory,
    dependencies: await Promise.all(
        Object.keys(dependencies)
            .filter(dep => dep.startsWith(prefix))
            .map(async name => ({
                name,
                directory: await getPackageDirectory(name),
            })),
    ),
})

const getAllDependencies = async (prefix: string) =>
    await Promise.all(
        getDirectories(packageDir).map(async directory => ({
            directory,
            ...JSON.parse(
                (await fs.readFile(`${directory}/package.json`)).toString(),
            ),
        })),
    ).then(
        async pckgs =>
            await Promise.all(
                pckgs.map(
                    async ({
                        directory,
                        dependencies = {},
                        devDependencies = {},
                    }) =>
                        await processPackage(prefix, directory, {
                            ...devDependencies,
                            ...dependencies,
                        }),
                ),
            ),
    )
const addReferencesTo = async ({
    directory: rootDirectory,
    dependencies,
}: ProcessedPackages) => {
    const tsconfigPath = `${rootDirectory}/tsconfig.json`
    const tsconfig = JSON.parse((await fs.readFile(tsconfigPath)).toString())
    const newTsconfig = {
        ...tsconfig,
        references: dependencies.map(({directory}) => ({
            path: relative(rootDirectory, directory),
        })),
    }
    await fs.writeFile(tsconfigPath, JSON.stringify(newTsconfig, undefined, 4))
}

const getPackagePrefix = async () => {
    const {name} = JSON.parse((await fs.readFile("./package.json")).toString())
    return `@${name}/`
}

const main = async () => {
    await getAllDependencies(await getPackagePrefix()).then(
        async dependencies =>
            await Promise.all(
                dependencies.map(async pckgs => await addReferencesTo(pckgs)),
            ),
    )
}

main().catch(console.error)
