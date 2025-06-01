import { world, system, MolangVariableMap } from "@minecraft/server"
import { ModalFormData } from "@minecraft/server-ui"
import { executeTasks, deleteTasks, harvestable, unbreakableBlocks, calculateDistance } from "./executeTasks"
import { droneTasks, droneMenu, simpleDroneTasks, antennaMenu, kUI } from "./mainSystem"
import { translation } from "./translation"
import { moveSystem } from "./moveSystem"

export function mineALocation(drone, player, p = {}) {
    const { dLang } = JSON.parse(player.getTags().find(f => { return f.includes('{"dLang":') }) ?? '{"dLang":0}')
    const menu = new ModalFormData().title(`${kUI}§g§f${translation(dLang, "mALoc")}`)
        .textField(`${p.coordsInvalid ? `§c` : `§f`}${translation(dLang, "from")}`, `x y z`, p.from)
        .textField(`${p.coordsInvalid ? `§c` : `§f`}${translation(dLang, "to")}`, `x y z`, p.to)
        .toggle(`§f${translation(dLang, "scitw")}`)
        .textField(`§f${translation(dLang, "bfeqb")} §g(${translation(dLang, "optio")})`, `stone, minecraft:grass_block, create:brass`, p.blocksFilter ?? "")
        .toggle(`§f${translation(dLang, "dtcrh")}`, p.harvest)
        .toggle(`§f${translation(dLang, "sabsa")}\n§c${translation(dLang, "llorm")}`, p.reload)
        .textField(`§f${translation(dLang, "ciwbs")} §g(${translation(dLang, "optio")})`, `x y z`, p.container ?? getContainer(drone.location, drone.dimension))

    p.antenna = (drone.typeId === "drone:antenna")
    menu.show(player).then(r => {
        if (!r.canceled) {
            if (!r.formValues[2]) {
                let chest = r.formValues[6].match(/-?\d+/g)
                let from = r.formValues[0].match(/-?\d+/g)
                let to = r.formValues[1].match(/-?\d+/g)

                if (from && to && from.length >= 3 && to.length >= 3) {
                    deleteTasks(drone, { drones: p.drones })

                    if (chest && chest.length >= 3) chest.forEach((f, i) => { chest[i] = parseInt(f) })
                    else chest = undefined
                    from.forEach((f, i) => { from[i] = parseInt(f) })
                    to.forEach((f, i) => { to[i] = parseInt(f) })

                    const [cx, cy, cz] = chest ?? []
                    const [fx, fy, fz] = from
                    const [tx, ty, tz] = to

                    const blocks = []
                    const blockFilter = r.formValues[3].match(/-?[\:\w]+/g) ?? []
                    blockFilter.forEach((f, i) => { if (!f.includes(":")) blockFilter[i] = "minecraft:" + f })

                    for (let x = Math.min(fx, tx); x <= Math.max(fx, tx); x++) {
                        for (let y = Math.min(fy, ty); y <= Math.max(fy, ty); y++) {
                            for (let z = Math.min(fz, tz); z <= Math.max(fz, tz); z++) {
                                const block = drone.dimension.getBlock({ x, y, z })
                                if (!block || block.isAir || block.isLiquid || unbreakableBlocks.includes(block.typeId) ||
                                    (r.formValues[4] && !harvestable.some(({ block: b, level: l, state }) => { return b === block.typeId && block.permutation.getState(state) === l })) || (r.formValues[3].length && !blockFilter.includes(block.typeId))) continue
                                blocks.push({ x, y, z })
                            }
                        }
                    }
                    for (const dron of p.drones ?? [drone]) {
                        dron.addTag(JSON.stringify({ task: `mALoc`, taskID: 1, from: [fx, fy, fz], to: [tx, ty, tz], harvest: r.formValues[4], reload: r.formValues[5], chest: chest ? [cx, cy, cz] : [] }))

                        if (r.formValues[3].length) dron.addTag(JSON.stringify({ bFilter: r.formValues[3].replace(/minecraft:/g, "").match(/-?[\:\w]+/g) }))
                        dron.getComponent('minecraft:mark_variant').value = 1
                        dron.addTag(JSON.stringify({ taskUniqueID: `${Math.random()}` }))
                        executeTasks(dron, 1, { firstCall: true, blocksList: blocks })
                    }
                    if (p.antenna) radiiAndTicks(drone, player)
                }
                else mineALocation(drone, player, { from: r.formValues[0], to: r.formValues[1], harvest: r.formValues[4], reload: r.formValues[5], blocksFilter: r.formValues[3], coordsInvalid: true, drones: p.drones })
            }
            else selectMod()
        }
        else p.backToMain ? p.antenna ? antennaMenu({ entity: drone, player }) : droneMenu({ target: drone, player }, p) : droneTasks(drone, player, p)
    }).catch(e => { if (`${e}`.includes('malformed')) selectMod() })

    function selectMod() {
        deleteTasks(drone, { drones: p.drones })
        if (p.drones) {
            const { swarmID } = JSON.parse(drone.getTags().find(f => { return f.includes('{"swarmID":"') }) ?? '{}')
            if (!swarmID) return
            for (const dron of p.drones) {
                dron.getComponent('minecraft:skin_id').value = 1
            }
            player.addTag(JSON.stringify({ selectMode: true, droneId: swarmID, from: translation(dLang, "noSel"), to: translation(dLang, "noSel"), taskID: 1, swarm: true }))
            selectInfo([player])
        }
        else {
            player.addTag(JSON.stringify({ selectMode: true, droneId: drone.id, from: translation(dLang, "noSel"), to: translation(dLang, "noSel"), taskID: 1 }))
            drone.getComponent('minecraft:skin_id').value = 1
            selectInfo([player])
        }
    }
}

export function killMobs(drone, player, p = {}) {
    const { dLang } = JSON.parse(player.getTags().find(f => { return f.includes('{"dLang":') }) ?? '{"dLang":0}')
    const menu = new ModalFormData().title(`${kUI}§g§f${translation(dLang, "kllMb")}`)
    let { x, y, z } = p.drones ? player.location : drone.location
    x = Math.floor(x), y = Math.floor(y), z = Math.floor(z)
    p.antenna = (drone.typeId === "drone:antenna")

    menu.textField(`§f${translation(dLang, "mobfl")} §g(${translation(dLang, "optio")})`, `player, minecraft:villager, namespac:herobrine`, p.mobFilter)
        .toggle(translation(dLang, "animl"), p.animals)
        .toggle(translation(dLang, "monst"), p.monsters ?? true)
        .toggle(translation(dLang, "wtcre"), p.aquaticMobs)
        .toggle(translation(dLang, "fMobs"), p.flyMobs)
        .toggle(translation(dLang, "acree"), p.avoidCreepers ?? true)
        .toggle(translation(dLang, "itmob"), p.ignorePets ?? true)
        .textField(`${p.error ? `§c` : ``}${translation(dLang, "src")}`, `x y z`, p.radiusCenter ?? `${x} ${y} ${z}`)
        .slider(translation(dLang, "srBks"), 4, 128, 4, p.radius ?? 32)
        .toggle(`§f${translation(dLang, "fptss")}`, p.followPlayer)

    menu.show(player).then(r => {
        if (!r.canceled) {
            let center = r.formValues[7].match(/-?\d+/g)
            deleteTasks(drone, { drones: p.drones })

            if ((center && center.length >= 3) || r.formValues[9]) {
                if (!r.formValues[9]) center.forEach((f, i) => { center[i] = parseInt(f) })
                const [x, y, z] = r.formValues[9] ? [0, 0, 0] : center

                for (const dron of p.drones ?? [drone]) {
                    let data = { task: `kllMb`, taskID: 2, radiusCenter: [x, y, z], radius: r.formValues[8], animals: r.formValues[1], monsters: r.formValues[2], aquaticMobs: r.formValues[3], flyMobs: r.formValues[4], avoidCreepers: r.formValues[5], ignorePets: r.formValues[6] }
                    if (r.formValues[9]) {
                        data.radiusCenter = []; data.radius = 8; data.followPlayer = true; data.playerID = player.id
                    }
                    dron.addTag(JSON.stringify(data))
                    if (r.formValues[0].length) dron.addTag(JSON.stringify({ mFilter: r.formValues[0].replace(/minecraft:/g, "").match(/-?[\:\w]+/g) }))
                    dron.getComponent('minecraft:mark_variant').value = 2
                    dron.addTag(JSON.stringify({ taskUniqueID: `${Math.random()}` }))
                    executeTasks(dron, 2, { firstCall: true })
                }
                if (p.antenna) radiiAndTicks(drone, player)
            }
            else killMobs(drone, player, { error: true, mobFilter: r.formValues[0], radiusCenter: r.formValues[7], radius: r.formValues[8], animals: r.formValues[1], monsters: r.formValues[2], aquaticMobs: r.formValues[3], flyMobs: r.formValues[4], avoidCreepers: r.formValues[5], ignorePets: r.formValues[6], followPlayer: r.formValues[9], drones: p.drones })
        }
        else p.backToMain ? p.antenna ? antennaMenu({ entity: drone, player }) : droneMenu({ target: drone, player }, p) : droneTasks(drone, player, p)
    })
}

export function fillLocation(drone, player, p = {}) {
    const { dLang } = JSON.parse(player.getTags().find(f => { return f.includes('{"dLang":') }) ?? '{"dLang":0}')
    const menu = new ModalFormData().title(`${kUI}§g§f${translation(dLang, "fALoc")}`)
        .textField(`${p.coordsInvalid ? `§c` : `§f`}${translation(dLang, "from")}`, `x y z`, p.from)
        .textField(`${p.coordsInvalid ? `§c` : `§f`}${translation(dLang, "to")}`, `x y z`, p.to)
        .toggle(`§f${translation(dLang, "scitw")}`)
        .textField(`${p.coordsInvalid ? `§c` : `§f`}${translation(dLang, "bccds")}`, `x y z`, p.container ?? getContainer(drone.location, drone.dimension))
        .toggle(`§f${translation(dLang, "cmdps")}`, p.grow)
        .toggle(`§f${translation(dLang, "rtsas")}\n§c${translation(dLang, "llorm")}`, p.reload)

    p.antenna = (drone.typeId === "drone:antenna")
    menu.show(player).then(r => {
        if (!r.canceled) {
            if (!r.formValues[2]) {
                let chest = r.formValues[3].match(/-?\d+/g)
                let from = r.formValues[0].match(/-?\d+/g)
                let to = r.formValues[1].match(/-?\d+/g)

                if (from && to && chest && from.length >= 3 && to.length >= 3 && chest.length >= 3) {
                    deleteTasks(drone, { drones: p.drones })

                    chest.forEach((f, i) => { chest[i] = parseInt(f) })
                    from.forEach((f, i) => { from[i] = parseInt(f) })
                    to.forEach((f, i) => { to[i] = parseInt(f) })

                    const [cx, cy, cz] = chest
                    let [fx, fy, fz] = from
                    let [tx, ty, tz] = to

                    fy = fy + (r.formValues[4] ? 1 : 0)
                    ty = ty + (r.formValues[4] ? 1 : 0)
                    const blocks = []

                    for (let y = Math.min(fy, ty); y <= Math.max(fy, ty); y++) {
                        for (let x = Math.min(fx, tx); x <= Math.max(fx, tx); x++) {
                            for (let z = Math.min(fz, tz); z <= Math.max(fz, tz); z++) {
                                const block = drone.dimension.getBlock({ x, y, z })
                                if (!block || (!r.formValues[4] && !block.isAir && !block.isLiquid) || (r.formValues[4] && block.below().typeId != "minecraft:farmland")) continue
                                blocks.push({ x, y, z })
                            }
                        }
                    }
                    for (const dron of p.drones ?? [drone]) {
                        dron.addTag(JSON.stringify({ task: `fALoc`, taskID: 3, grow: r.formValues[4], reload: r.formValues[5], from: [fx, fy, fz], to: [tx, ty, tz], chest: [cx, cy, cz] }))
                        dron.getComponent('minecraft:mark_variant').value = 3
                        dron.addTag(JSON.stringify({ taskUniqueID: `${Math.random()}` }))
                        executeTasks(dron, 3, { firstCall: true, blocksList: blocks })
                    }
                    if (p.antenna) radiiAndTicks(drone, player)
                }
                else fillLocation(drone, player, { from: r.formValues[0], to: r.formValues[1], container: r.formValues[3], grow: r.formValues[4], coordsInvalid: true, drones: p.drones })
            }
            else selectMod()
        }
        else p.backToMain ? p.antenna ? antennaMenu({ entity: drone, player }) : droneMenu({ target: drone, player }, p) : droneTasks(drone, player, p)
    }).catch(e => { if (`${e}`.includes('malformed')) selectMod() })
    function selectMod() {
        deleteTasks(drone, { drones: p.drones })
        if (p.drones) {
            const { swarmID } = JSON.parse(drone.getTags().find(f => { return f.includes('{"swarmID":"') }) ?? '{}')
            if (!swarmID) return
            for (const dron of p.drones) {
                dron.getComponent('minecraft:skin_id').value = 1
            }
            player.addTag(JSON.stringify({ selectMode: true, droneId: swarmID, from: translation(dLang, "noSel"), to: translation(dLang, "noSel"), taskID: 3, swarm: true }))
            selectInfo([player])
        }
        else {
            player.addTag(JSON.stringify({ selectMode: true, droneId: drone.id, from: translation(dLang, "noSel"), to: translation(dLang, "noSel"), taskID: 3 }))
            drone.getComponent('minecraft:skin_id').value = 1
            selectInfo([player])
        }
    }
}

export function bringMobs(drone, player, p = {}) {
    const { dLang } = JSON.parse(player.getTags().find(f => { return f.includes('{"dLang":') }) ?? '{"dLang":0}')
    const menu = new ModalFormData().title(`${kUI}§g§f${translation(dLang, "bMobs")}`)
    let { x, y, z } = p.drones ? player.location : drone.location
    x = Math.floor(x), y = Math.floor(y), z = Math.floor(z)
    p.antenna = (drone.typeId === "drone:antenna")

    menu.textField(`${p.error ? `§c` : `§f`}${translation(dLang, "lmbin")}`, `x y z`, p.coords ?? `${x} ${y + 1} ${z}`)
        .slider(translation(dLang, "msr"), 5, 15, 1, p.minRad ?? 8)
        .slider(translation(dLang, "mxsr"), 16, 128, 1, p.rad ?? 48)
        .textField(`§f${translation(dLang, "mobfl")} §g(${translation(dLang, "optio")})`, `cow, pig, minecraft:sheep, namespace:bear`, p.mobFilter)
        .toggle(`${translation(dLang, "animl")} §8${translation(dLang, "mfwbi")}`, p.animals ?? true)
        .toggle(`${translation(dLang, "monst")} §8${translation(dLang, "mfwbi")}`, p.monsters)
        .toggle(`${translation(dLang, "wtcre")} §8${translation(dLang, "mfwbi")}`, p.aquaticMobs)
        .toggle(`${translation(dLang, "fMobs")}\n§8${translation(dLang, "mfwbi")}`, p.flyMobs)

    menu.show(player).then(r => {
        if (!r.canceled) {
            let coords = r.formValues[0].match(/-?\d+/g)

            if (coords && coords.length >= 3) {
                deleteTasks(drone, { drones: p.drones })

                coords.forEach((f, i) => { coords[i] = parseInt(f) })
                const [x, y, z] = coords

                for (const dron of p.drones ?? [drone]) {
                    dron.addTag(JSON.stringify({ task: `bMobs`, taskID: 4, coords: [x, y, z], minRad: r.formValues[1], rad: r.formValues[2], animals: r.formValues[4], monsters: r.formValues[5], aquaticMobs: r.formValues[6], flyMobs: r.formValues[7] }))
                    if (r.formValues[0].length) dron.addTag(JSON.stringify({ mFilter: r.formValues[3].replace(/minecraft:/g, "").match(/-?[\:\w]+/g) }))
                    dron.getComponent('minecraft:mark_variant').value = 4
                    dron.addTag(JSON.stringify({ taskUniqueID: `${Math.random()}` }))
                    executeTasks(dron, 4, { firstCall: true })
                }
                if (p.antenna) radiiAndTicks(drone, player)
            }
            else killMobs(drone, player, { error: true, mobFilter: r.formValues[3], coords: r.formValues[0], minRad: r.formValues[1], rad: r.formValues[2], animals: r.formValues[4], monsters: r.formValues[5], aquaticMobs: r.formValues[6], flyMobs: r.formValues[7], drones: p.drones })
        }
        else p.backToMain ? p.antenna ? antennaMenu({ entity: drone, player }) : droneMenu({ target: drone, player }, p) : droneTasks(drone, player, p)
    })
}

export function mineNearbyBlocks(drone, player, p = {}) {
    const { dLang } = JSON.parse(player.getTags().find(f => { return f.includes('{"dLang":') }) ?? '{"dLang":0}')
    const menu = new ModalFormData().title(`${kUI}§g§f${translation(dLang, "mNBlo")}`)
        .textField(`§f${translation(dLang, "bfeqb")} §g(${translation(dLang, "optio")})`, `stone, minecraft:coal_ore, custom:ruby_ore`, p.blocksFilter ?? "")
        .slider(`§c${translation(dLang, "hsrcl")}§`, 2, 16, 1, p.hScanRadius ?? 4)
        .slider(`§f${translation(dLang, "vsrbs")}§`, 1, 5, 1, p.vScanRadius ?? 2)
        .toggle(`§f${translation(dLang, "fpifv")}`, p.followPlayer ?? true)

    p.antenna = (drone.typeId === "drone:antenna")
    menu.show(player).then(r => {
        if (!r.canceled) {
            deleteTasks(drone, { drones: p.drones })
            for (const dron of p.drones ?? [drone]) {
                dron.addTag(JSON.stringify({ task: `mNBlo`, taskID: 5, hScanRadius: r.formValues[1], vScanRadius: r.formValues[2], followPlayer: r.formValues[3], playerID: player.id }))
                if (r.formValues[0].length) dron.addTag(JSON.stringify({ bFilter: r.formValues[0].replace(/minecraft:/g, "").match(/-?[\:\w]+/g) }))

                dron.getComponent('minecraft:mark_variant').value = 5
                dron.addTag(JSON.stringify({ taskUniqueID: `${Math.random()}` }))
                executeTasks(dron, 5, { firstCall: true })
            }
            if (p.antenna) radiiAndTicks(drone, player)
        }
        else p.backToMain ? p.antenna ? antennaMenu({ entity: drone, player }) : droneMenu({ target: drone, player }, p) : droneTasks(drone, player, p)
    })
}

export function collectItems(drone, player, p = {}) {
    const { dLang } = JSON.parse(player.getTags().find(f => { return f.includes('{"dLang":') }) ?? '{"dLang":0}')
    const menu = new ModalFormData().title(`${kUI}§g§f${translation(dLang, "cItem")}`)
    let { x, y, z } = p.drones ? player.location : drone.location
    x = Math.floor(x), y = Math.floor(y), z = Math.floor(z)
    p.antenna = (drone.typeId === "drone:antenna")

    menu.textField(`${p.error ? `§c` : `§f`}${translation(dLang, "src")}`, `x y z`, p.center ?? `${x} ${y} ${z}`)
        .slider(`§f${translation(dLang, "rdbls")}:§`, 4, 128, 1, p.radius ?? 16)
        .textField(`${p.error ? `§c` : `§f`}${translation(dLang, "ciwbs")} `, `x y z`, p.chest ?? getContainer(drone.location, drone.dimension))
        .toggle(`§f${translation(dLang, "fppsr")}`, p.followPlayer)
        .textField(`§f${translation(dLang, "ifeei")} §g(${translation(dLang, "optio")})`, `oak_log, minecraft:coal, custom:ruby`, p.itemsFilter ?? "")

    menu.show(player).then(r => {
        if (!r.canceled) {
            let center = r.formValues[0].match(/-?\d+/g)
            let chest = r.formValues[2].match(/-?\d+/g)

            if (r.formValues[3]) {
                deleteTasks(drone, { drones: p.drones })
                for (const dron of p.drones ?? [drone]) {
                    dron.addTag(JSON.stringify({ task: `cItem`, taskID: 6, center: [], chest: [], radius: 8, followPlayer: true, playerID: player.id }))
                    if (r.formValues[4].length) dron.addTag(JSON.stringify({ iFilter: r.formValues[4].replace(/minecraft:/g, "").match(/-?[\:\w]+/g) }))
                    dron.getComponent('minecraft:mark_variant').value = 6
                    dron.addTag(JSON.stringify({ taskUniqueID: `${Math.random()}` }))
                    executeTasks(dron, 6, { firstCall: true })
                }
                if (p.antenna) radiiAndTicks(drone, player)
            }
            else if (center && center.length >= 3 && chest && chest.length >= 3) {
                deleteTasks(drone, { drones: p.drones })
                center.forEach((f, i) => { center[i] = parseInt(f) })
                chest.forEach((f, i) => { chest[i] = parseInt(f) })
                const [x, y, z] = center
                const [cx, cy, cz] = chest

                for (const dron of p.drones ?? [drone]) {
                    dron.addTag(JSON.stringify({ task: `cItem`, taskID: 6, center: [x, y, z], chest: [cx, cy, cz], radius: r.formValues[1] }))
                    if (r.formValues[4].length) dron.addTag(JSON.stringify({ iFilter: r.formValues[4].replace(/minecraft:/g, "").match(/-?[\:\w]+/g) }))
                    dron.getComponent('minecraft:mark_variant').value = 6
                    dron.addTag(JSON.stringify({ taskUniqueID: `${Math.random()}` }))
                    executeTasks(dron, 6, { firstCall: true })
                }
                if (p.antenna) radiiAndTicks(drone, player)
            }
            else collectItems(drone, player, { error: true, center: r.formValues[0], radius: r.formValues[1], chest: r.formValues[2], followPlayer: r.formValues[3], itemsFilter: r.formValues[4] })
        }
        else p.backToMain ? p.antenna ? antennaMenu({ entity: drone, player }) : droneMenu({ target: drone, player }, p) : droneTasks(drone, player, p)
    })
}

export function oreDetector(drone, player, p = {}) {
    const { dLang } = JSON.parse(player.getTags().find(f => { return f.includes('{"dLang":') }) ?? '{"dLang":0}')
    const menu = new ModalFormData().title(`${kUI}§g§f${translation(dLang, "oDect")}`)
        .dropdown(`§f${translation(dLang, "vOre")}`, [translation(dLang, "iore"), translation(dLang, "gore"), translation(dLang, "dore"), translation(dLang, "llore"), translation(dLang, "rore"), translation(dLang, "core"), translation(dLang, "cpore"), translation(dLang, "eore"), translation(dLang, "qore"), translation(dLang, "adore")], p.ore)
        .textField(`${p.error ? `§c` : `§f`}${translation(dLang, "ctOre")} §g(${translation(dLang, "optio")})\n§8${translation(dLang, "oabck")}`, `namespace:ruby_ore`, p.customOre)
        .slider(`§4${translation(dLang, "hsrcl")}§`, 2, 8, 1, p.hScanRadius ?? 5)
        .slider(`§f${translation(dLang, "vsrbs")}§`, 2, 8, 1, p.vScanRadius ?? 2)
        .dropdown(`§f${translation(dLang, "fptse")}`, [`random.toast pitch: 6`, `random.levelup pitch: 5`, `random.orb pitch: 5`], p.sound)

    p.antenna = (drone.typeId === "drone:antenna")
    menu.show(player).then(r => {
        if (!r.canceled) {
            if (r.formValues[1].length) {
                if (!r.formValues[1].includes(":") || ["ore_", "_ore_", "_ore"].every(f => { return !r.formValues[1].includes(f) })) {
                    oreDetector(drone, player, { error: true, ore: r.formValues[0], customOre: r.formValues[1], hScanRadius: r.formValues[2], vScanRadius: r.formValues[3], sound: r.formValues[4] })
                    return
                }
            }
            deleteTasks(drone, { drones: p.drones })
            for (const dron of p.drones ?? [drone]) {
                dron.addTag(JSON.stringify({ task: `oDect`, taskID: 7, ore: r.formValues[0], customOre: r.formValues[1].length ? r.formValues[1] : undefined, hScanRadius: r.formValues[2], vScanRadius: r.formValues[3], sound: r.formValues[4], playerID: player.id }))
                dron.getComponent('minecraft:mark_variant').value = 7
                dron.addTag(JSON.stringify({ taskUniqueID: `${Math.random()}` }))
                executeTasks(dron, 7, { firstCall: true })
            }
            if (p.antenna) radiiAndTicks(drone, player)
        }
        else p.backToMain ? p.antenna ? antennaMenu({ entity: drone, player }) : droneMenu({ target: drone, player }, p) : droneTasks(drone, player, p)
    })
}

export function moveItems(drone, player, p = {}) {
    const { dLang } = JSON.parse(player.getTags().find(f => { return f.includes('{"dLang":') }) ?? '{"dLang":0}')
    const menu = new ModalFormData().title(`${kUI}§g§f${translation(dLang, "mItem")}`)
        .textField(`${p.error ? `§c` : `§f`}${translation(dLang, "contr")} A`, `x y z`, p.contA ?? getContainer(drone.location, drone.dimension))
        .textField(`${p.error ? `§c` : `§f`}${translation(dLang, "contr")} B`, `x y z`, p.contB)
        .textField(`§f${translation(dLang, "ifeei")} §g(${translation(dLang, "optio")})`, `diamond, minecraft:coal, custom:ruby`, p.itemsFilter ?? "")

    p.antenna = (drone.typeId === "drone:antenna")
    menu.show(player).then(r => {
        if (!r.canceled) {
            let contA = r.formValues[0].match(/-?\d+/g)
            let contB = r.formValues[1].match(/-?\d+/g)

            if (contA && contA.length >= 3 && contB && contB.length >= 3) {
                deleteTasks(drone, { drones: p.drones })
                contA.forEach((f, i) => { contA[i] = parseInt(f) })
                contB.forEach((f, i) => { contB[i] = parseInt(f) })
                const [ax, ay, az] = contA
                const [bx, by, bz] = contB

                for (const dron of p.drones ?? [drone]) {
                    dron.addTag(JSON.stringify({ task: `mItem`, taskID: 8, contA: [ax, ay, az], contB: [bx, by, bz] }))
                    if (r.formValues[2].length) dron.addTag(JSON.stringify({ iFilter: r.formValues[2].replace(/minecraft:/g, "").match(/-?[\:\w]+/g) }))
                    dron.getComponent('minecraft:mark_variant').value = 8
                    dron.addTag(JSON.stringify({ taskUniqueID: `${Math.random()}` }))
                    executeTasks(dron, 8, { firstCall: true })
                }
                if (p.antenna) radiiAndTicks(drone, player)
            }
            else moveItems(drone, player, { error: true, contA: r.formValues[0], contB: r.formValues[1], itemsFilter: r.formValues[2] })
        }
        else p.backToMain ? p.antenna ? antennaMenu({ entity: drone, player }) : droneMenu({ target: drone, player }, p) : droneTasks(drone, player, p)
    })
}

export function removeLiquids(drone, player, p = {}) {
    const { dLang } = JSON.parse(player.getTags().find(f => { return f.includes('{"dLang":') }) ?? '{"dLang":0}')
    const menu = new ModalFormData().title(`${kUI}§g§f${translation(dLang, "remlq")}`)
        .textField(`${p.coordsInvalid ? `§c` : `§f`}${translation(dLang, "from")}`, `x y z`, p.from)
        .textField(`${p.coordsInvalid ? `§c` : `§f`}${translation(dLang, "to")}`, `x y z`, p.to)
        .toggle(`§f${translation(dLang, "scitw")}`)
        .toggle(`§f${translation(dLang, "sabsa")}\n§c${translation(dLang, "llorm")}`, p.reload)

    p.antenna = (drone.typeId === "drone:antenna")
    menu.show(player).then(r => {
        if (!r.canceled) {
            if (!r.formValues[2]) {
                let from = r.formValues[0].match(/-?\d+/g)
                let to = r.formValues[1].match(/-?\d+/g)

                if (from && to && from.length >= 3 && to.length >= 3) {
                    deleteTasks(drone, { drones: p.drones })

                    from.forEach((f, i) => { from[i] = parseInt(f) })
                    to.forEach((f, i) => { to[i] = parseInt(f) })

                    const [fx, fy, fz] = from
                    const [tx, ty, tz] = to
                    const blocks = []

                    for (let x = Math.min(fx, tx); x <= Math.max(fx, tx); x++) {
                        for (let y = Math.min(fy, ty); y <= Math.max(fy, ty); y++) {
                            for (let z = Math.min(fz, tz); z <= Math.max(fz, tz); z++) {
                                const block = drone.dimension.getBlock({ x, y, z })
                                if (!block || block.isAir || !block.isLiquid || block.permutation.getState("liquid_depth") != 0) continue
                                blocks.push({ x, y, z })
                            }
                        }
                    }
                    for (const dron of p.drones ?? [drone]) {
                        dron.addTag(JSON.stringify({ task: `remlq`, taskID: 9, from: [fx, fy, fz], to: [tx, ty, tz], reload: r.formValues[3] }))

                        dron.getComponent('minecraft:mark_variant').value = 9
                        dron.addTag(JSON.stringify({ taskUniqueID: `${Math.random()}` }))
                        executeTasks(dron, 9, { firstCall: true, blocksList: blocks })
                    }
                    if (p.antenna) radiiAndTicks(drone, player)
                }
                else removeLiquids(drone, player, { from: r.formValues[0], to: r.formValues[1], reload: r.formValues[3], coordsInvalid: true, drones: p.drones })
            }
            else selectMod()
        }
        else p.backToMain ? p.antenna ? antennaMenu({ entity: drone, player }) : droneMenu({ target: drone, player }, p) : droneTasks(drone, player, p)
    }).catch(e => { if (`${e}`.includes('malformed')) selectMod() })
    function selectMod() {
        deleteTasks(drone, { drones: p.drones })
        if (p.drones) {
            const { swarmID } = JSON.parse(drone.getTags().find(f => { return f.includes('{"swarmID":"') }) ?? '{}')
            if (!swarmID) return
            for (const dron of p.drones) {
                dron.getComponent('minecraft:skin_id').value = 1
            }
            player.addTag(JSON.stringify({ selectMode: true, droneId: swarmID, from: translation(dLang, "noSel"), to: translation(dLang, "noSel"), taskID: 9, swarm: true }))
            selectInfo([player])
        }
        else {
            player.addTag(JSON.stringify({ selectMode: true, droneId: drone.id, from: translation(dLang, "noSel"), to: translation(dLang, "noSel"), taskID: 9 }))
            drone.getComponent('minecraft:skin_id').value = 1
            selectInfo([player])
        }
    }
}

function radiiAndTicks(antenna, player) {
    const { dLang } = JSON.parse(player.getTags().find(f => { return f.includes('{"dLang":') }) ?? '{"dLang":0}')
    const tagRadii = antenna.getTags().find(f => { return f.includes('{"scanRadius":') }) ?? `{"scanRadius":16}`
    let { scanRadius, ticks } = JSON.parse(tagRadii)
    const menu = new ModalFormData().title(`${kUI}§g§f${translation(dLang, "anten")}`).slider(`§f${translation(dLang, "asr")}`, 4, 16, 1, scanRadius ?? 16).slider(`§f${translation(dLang, "eses")}`, 1, 10, 1, ticks ? ticks / 20 : 1)
    menu.show(player).then(a => {
        if (!a.canceled) {
            antenna.removeTag(tagRadii)
            antenna.addTag(JSON.stringify({ scanRadius: a.formValues[0], ticks: a.formValues[1] * 20 }))
            executeTasks(antenna, 100, { firstCall: true }, a.formValues[1] * 20)
        }
        else {
            antenna.removeTag(tagRadii)
            antenna.addTag(JSON.stringify({ scanRadius: scanRadius ?? 16, ticks: ticks ?? 20 }))
            executeTasks(antenna, 100, { firstCall: true }, ticks ?? 20)
        }
    })
}

export function simpleTasks(entity, player, p = {}) {
    const { dLang } = JSON.parse(player.getTags().find(f => { return f.includes('{"dLang":') }) ?? '{"dLang":0}')
    const taskID = p.simpleTaskID
    const tagRadii = entity.getTags().find(f => { return f.includes('{"scanRadius":') }) ?? `{}`
    let { scanRadius, ticks } = JSON.parse(tagRadii)
    const alert = p.backToMain ? `§c${translation(dLang, "ttcsa")}` : ``
    const menu = new ModalFormData()

    p.antenna = (entity.typeId === "drone:antenna")
    const once = !p.antenna
    if (taskID === 0 || taskID === 99) {
        menu.title(`${kUI}§g§f${translation(dLang, "cBatt")}`).slider(`${alert}\n§f${translation(dLang, "cgrdi")}`, 4, 16, 1, scanRadius ?? 16).slider(`§f${translation(dLang, "eses")}`, 1, 10, 1, ticks ? ticks / 20 : 1)
        menu.show(player).then(r => {
            if (!r.canceled) {
                entity.removeTag(tagRadii)
                entity.addTag(JSON.stringify({ scanRadius: r.formValues[0], ticks: r.formValues[1] * 20 }))
                entity.addTag(JSON.stringify({ task: `cBatt`, taskID: 99 }))
                entity.addTag(JSON.stringify({ taskUniqueID: `${Math.random()}` }))
                executeTasks(entity, 99, { firstCall: true }, r.formValues[1] * 20)
            }
            else rTurn()
        })
    }
    else if (taskID === 1 || taskID === 97) {
        menu.title(`${kUI}§g§f${translation(dLang, "gTLoc")}`).textField(`${alert}${p.error ? `\n§c` : `\n§f`}${translation(dLang, "coord")}`, `x y z`, p.coordinates).toggle(`Kamikaze`, p.kamikaze)
        if (p.antenna) menu.slider(`§f${translation(dLang, "asr")}`, 4, 16, 1, scanRadius ?? 16).slider(`§f${translation(dLang, "eses")}`, 1, 10, 1, ticks ? ticks / 20 : 1)

        menu.show(player).then(r => {
            if (!r.canceled) {
                let coords = r.formValues[0].match(/-?\d+/g)
                if (coords && coords.length >= 3) {
                    coords.forEach((f, i) => { coords[i] = parseInt(f) })
                    const [x, y, z] = coords
                    if (once) {
                        for (const dron of p.drones ?? [entity]) {
                            dron.removeTag("RuntimeOut")
                            moveSystem(dron, { location: { x, y, z }, kamikaze: r.formValues[1], timer: 0, break: true, gonna: true })
                        }
                    }
                    else {
                        entity.removeTag(tagRadii)
                        entity.addTag(JSON.stringify({ scanRadius: r.formValues[2], ticks: r.formValues[3] * 20 }))
                        entity.addTag(JSON.stringify({ task: `gTLoc`, taskID: 97, coordinates: [x, y, z], kamikaze: r.formValues[1] }))
                        entity.addTag(JSON.stringify({ taskUniqueID: `${Math.random()}` }))
                        executeTasks(entity, 97, { firstCall: true }, r.formValues[3] * 20)
                    }
                }
                else {
                    p.error = true
                    simpleTasks(entity, player, p)
                }
            }
            else rTurn()
        })
    }
    else if (taskID === 2 || taskID === 96) {
        menu.title(`${kUI}§g§f${translation(dLang, "sInve")}`).textField(`${alert}${p.error ? `\n§c` : `\n§f`}${translation(dLang, "contr")}`, `x y z`, p.container ?? getContainer(player.location, player.dimension))
        if (p.antenna) menu.slider(`§f${translation(dLang, "asr")}`, 4, 16, 1, scanRadius ?? 16).slider(`§f${translation(dLang, "eses")}`, 1, 10, 1, ticks ? ticks / 20 : 1)
        menu.show(player).then(r => {
            if (!r.canceled) {
                let coords = r.formValues[0].match(/-?\d+/g)
                if (coords && coords.length >= 3) {
                    coords.forEach((f, i) => { coords[i] = parseInt(f) })
                    const [x, y, z] = coords
                    if (once) {
                        for (const dron of p.drones ?? [entity]) {
                            dron.removeTag("RuntimeOut")
                            moveSystem(dron, { location: { x, y, z }, timer: 0, break: true, saveInv: true })
                        }
                    }
                    else {
                        entity.removeTag(tagRadii)
                        entity.addTag(JSON.stringify({ scanRadius: r.formValues[1], ticks: r.formValues[2] * 20 }))
                        entity.addTag(JSON.stringify({ task: `sInve`, taskID: 96, container: [x, y, z] }))
                        entity.addTag(JSON.stringify({ taskUniqueID: `${Math.random()}` }))
                        executeTasks(entity, 96, { firstCall: true }, r.formValues[2] * 20)
                    }
                }
                else {
                    p.error = true
                    simpleTasks(entity, player, p)
                }
            }
            else rTurn()
        })
    }
    else if (taskID === 3 || taskID === 95) {
        menu.title(`${kUI}§g§f${translation(dLang, "tIFCo")}`).textField(`${alert}${p.error ? `\n§c` : `\n§f`}${translation(dLang, "contr")}`, `x y z`, p.container ?? getContainer(player.location, player.dimension))
        if (p.antenna) menu.slider(`§f${translation(dLang, "asr")}`, 4, 16, 1, scanRadius ?? 16).slider(`§f${translation(dLang, "eses")}`, 1, 10, 1, ticks ? ticks / 20 : 1)
        menu.show(player).then(r => {
            if (!r.canceled) {
                let coords = r.formValues[0].match(/-?\d+/g)
                if (coords && coords.length >= 3) {
                    coords.forEach((f, i) => { coords[i] = parseInt(f) })
                    const [x, y, z] = coords
                    if (once) {
                        for (const dron of p.drones ?? [entity]) {
                            dron.removeTag("RuntimeOut")
                            moveSystem(dron, { location: { x, y, z }, timer: 0, break: true, takeChestItem: true })
                        }
                    }
                    else {
                        entity.removeTag(tagRadii)
                        entity.addTag(JSON.stringify({ scanRadius: r.formValues[1], ticks: r.formValues[2] * 20 }))
                        entity.addTag(JSON.stringify({ task: `tIFCo`, taskID: 95, container: [x, y, z] }))
                        entity.addTag(JSON.stringify({ taskUniqueID: `${Math.random()}` }))
                        executeTasks(entity, 95, { firstCall: true }, r.formValues[2] * 20)
                    }
                }
                else {
                    p.error = true
                    simpleTasks(entity, player, p)
                }
            }
            else rTurn()
        })
    }
    else if (taskID === 4 || taskID === 98) {
        if (once) {
            for (const dron of p.drones ?? [entity]) {
                const inventory = dron.getComponent("inventory").container
                for (let i = 0; i < inventory.size; i++) {
                    const item = inventory.getItem(i)
                    if (inventory.emptySlotsCount === inventory.size) break
                    else if (!item) continue
                    dron.dimension.spawnItem(item, dron.location)
                    inventory.setItem(i, undefined)
                }
            }
            return
        }
        else {
            menu.title(`${kUI}§g§f${translation(dLang, "dInve")}`).slider(`${alert}\n§f${translation(dLang, "asr")}`, 4, 16, 1, scanRadius ?? 16).slider(`§f${translation(dLang, "eses")}`, 1, 10, 1, ticks ? ticks / 20 : 1)
            menu.show(player).then(r => {
                if (!r.canceled) {
                    entity.removeTag(tagRadii)
                    entity.addTag(JSON.stringify({ scanRadius: r.formValues[0], ticks: r.formValues[1] * 20 }))
                    entity.addTag(JSON.stringify({ task: `dInve`, taskID: 98 }))
                    entity.addTag(JSON.stringify({ taskUniqueID: `${Math.random()}` }))
                    executeTasks(entity, 98, { firstCall: true }, r.formValues[1] * 20)
                }
                else rTurn()
            })
        }
    }
    else if (taskID === 5 || taskID === 94) {
        menu.title(`${kUI}§g§f${translation(dLang, "clTsks")}`).slider(`${alert}\n§f${translation(dLang, "asr")}`, 4, 16, 1, scanRadius ?? 16).slider(`§f${translation(dLang, "eses")}`, 1, 10, 1, ticks ? ticks / 20 : 1)
        menu.show(player).then(r => {
            if (!r.canceled) {
                entity.removeTag(tagRadii)
                entity.addTag(JSON.stringify({ scanRadius: r.formValues[0], ticks: r.formValues[1] * 20 }))
                entity.addTag(JSON.stringify({ task: `clTsks`, taskID: 94 }))
                entity.addTag(JSON.stringify({ taskUniqueID: `${Math.random()}` }))
                executeTasks(entity, 94, { firstCall: true }, r.formValues[1] * 20)
            }
            else rTurn()
        })
    }
    else if (taskID === 6 || taskID === 93) {
        menu.title(`${kUI}§g§f${translation(dLang, "fMode")}`).slider(`${alert}\n§f${translation(dLang, "asr")}`, 4, 16, 1, scanRadius ?? 16).slider(`§f${translation(dLang, "eses")}`, 1, 10, 1, ticks ? ticks / 20 : 1)
        menu.show(player).then(r => {
            if (!r.canceled) {
                entity.removeTag(tagRadii)
                entity.addTag(JSON.stringify({ scanRadius: r.formValues[0], ticks: r.formValues[1] * 20 }))
                entity.addTag(JSON.stringify({ task: `fMode`, taskID: 93 }))
                entity.addTag(JSON.stringify({ taskUniqueID: `${Math.random()}` }))
                executeTasks(entity, 93, { firstCall: true }, r.formValues[1] * 20)
            }
            else rTurn()
        })
    }
    else if (taskID === 7 || taskID === 92) {
        menu.title(`${kUI}§g§f${translation(dLang, "wMode")}`).slider(`${alert}\n§f${translation(dLang, "asr")}`, 4, 16, 1, scanRadius ?? 16).slider(`§f${translation(dLang, "eses")}`, 1, 10, 1, ticks ? ticks / 20 : 1)
        menu.show(player).then(r => {
            if (!r.canceled) {
                entity.removeTag(tagRadii)
                entity.addTag(JSON.stringify({ scanRadius: r.formValues[0], ticks: r.formValues[1] * 20 }))
                entity.addTag(JSON.stringify({ task: `wMode`, taskID: 92 }))
                entity.addTag(JSON.stringify({ taskUniqueID: `${Math.random()}` }))
                executeTasks(entity, 92, { firstCall: true }, r.formValues[1] * 20)
            }
            else rTurn()
        })
    }
    function rTurn() {
        p.backToMain ? antennaMenu({ entity, player }) : simpleDroneTasks(entity, player, p)
    }
}

export function getContainer({ x, y, z }, dimension) {
    const blocks = []
    for (let i = -4; i <= 4; i++) {
        for (let j = -4; j <= 4; j++) {
            for (let k = -4; k <= 4; k++) {
                const coords = { x: Math.floor(x) + i, y: Math.floor(y) + j, z: Math.floor(z) + k }
                const block = dimension.getBlock(coords)
                if (block && block.getComponent("inventory") && block.getComponent("inventory").container.size >= 5) blocks.push(coords)
            }
        }
    }
    if (!blocks[0]) return
    let closestBlock = blocks[0]
    for (const blockLocation of blocks) {
        const distance = calculateDistance({ x, y, z }, blockLocation)
        let closestDistance = Infinity
        if (distance < closestDistance) {
            closestDistance = distance
            closestBlock = blockLocation
        }
    }
    return `${[closestBlock.x, closestBlock.y, closestBlock.z].join(" ")}`
}

export function selectMode(b) {
    const selectData = b.player.getTags().find(f => { return f.includes('{"selectMode":t') })
    const { dLang } = JSON.parse(b.player.getTags().find(f => { return f.includes('{"dLang":') }) ?? '{"dLang":0}')
    if (selectData) {
        b.cancel = true
        if (!b.player.hasTag("selectCooldown")) {
            let { from, to, droneId, taskID, swarm } = JSON.parse(selectData)
            const { x, y, z } = b.block.location

            if (!to.includes("§N")) {
                system.runTimeout(() => {
                    b.player.removeTag(selectData)
                    b.player.onScreenDisplay.setActionBar(`${translation(dLang, "selMd")} \n§c${translation(dLang, "cdSel")}`)
                    for (const drone of b.player.dimension.getEntities({ type: "effect99:drone" })) {
                        drone.getComponent('minecraft:skin_id').value = 0
                    }
                })
                return
            }

            if (from.includes("§N")) from = `${[x, y, z]}`
            else if (to.includes("§N")) to = `${[x, y, z]}`

            system.runTimeout(() => {
                b.player.removeTag(selectData)
                b.player.addTag(JSON.stringify({ selectMode: true, droneId: droneId, from: from, to: to, taskID, swarm }))
                selectInfo([b.player])
                b.player.addTag("selectCooldown")
            })

            system.runTimeout(() => { b.player.removeTag("selectCooldown") }, 10)
        }
    }
}
export function cloneStructure(drone, player, p = {}) {
    const { dLang } = JSON.parse(player.getTags().find(f => { return f.includes('{"dLang":') }) ?? '{"dLang":0}')
    const menu = new ModalFormData().title(`${kUI}§g§f${translation(dLang, "clnStr")}`)
        .textField(`${p.coordsInvalid ? `§c` : `§f`}${translation(dLang, "from")} (${translation(dLang, "blueprint")} origin)`, `x y z`, p.from)
        .textField(`${p.coordsInvalid ? `§c` : `§f`}${translation(dLang, "to")} (${translation(dLang, "blueprint")} end)`, `x y z`, p.to)
        .textField(`${p.buildError ? `§c` : `§f`}${translation(dLang, "coord")} (Build location)`, `x y z`, p.buildLocation)
        .textField(`§f${translation(dLang, "ciwbs")} §g(${translation(dLang, "optio")})`, `x y z`, p.container ?? getContainer(drone.location, drone.dimension))
        .toggle(`§f${translation(dLang, "sabsa")}`, p.reload)

    p.antenna = (drone.typeId === "drone:antenna")
    menu.show(player).then(r => {
        if (!r.canceled) {
            let blueprint_from = r.formValues[0].match(/-?\d+/g)
            let blueprint_to = r.formValues[1].match(/-?\d+/g)
            let build_location = r.formValues[2].match(/-?\d+/g)
            let chest = r.formValues[3].match(/-?\d+/g)

            if (blueprint_from && blueprint_to && build_location && blueprint_from.length >= 3 && blueprint_to.length >= 3 && build_location.length >= 3) {
                deleteTasks(drone, { drones: p.drones })

                blueprint_from.forEach((f, i) => { blueprint_from[i] = parseInt(f) })
                blueprint_to.forEach((f, i) => { blueprint_to[i] = parseInt(f) })
                build_location.forEach((f, i) => { build_location[i] = parseInt(f) })
                if (chest && chest.length >= 3) chest.forEach((f, i) => { chest[i] = parseInt(f) })

                for (const dron of p.drones ?? [drone]) {
                    dron.addTag(JSON.stringify({
                        task: `clnStr`,
                        taskID: 10,
                        blueprintFrom: blueprint_from,
                        blueprintTo: blueprint_to,
                        buildLocation: build_location,
                        chest: chest ? chest : [],
                        reload: r.formValues[4]
                    }))
                    dron.getComponent('minecraft:mark_variant').value = 10
                    dron.addTag(JSON.stringify({ taskUniqueID: `${Math.random()}` }))
                    executeTasks(dron, 10, { firstCall: true })
                }
                if (p.antenna) radiiAndTicks(drone, player)
            }
            else cloneStructure(drone, player, {
                from: r.formValues[0],
                to: r.formValues[1],
                buildLocation: r.formValues[2],
                container: r.formValues[3],
                reload: r.formValues[4],
                coordsInvalid: true,
                drones: p.drones
            })
        }
        else p.backToMain ? p.antenna ? antennaMenu({ entity: drone, player }) : droneMenu({ target: drone, player }, p) : droneTasks(drone, player, p)
    })
}

export function fishing(drone, player, p = {}) {
    const { dLang } = JSON.parse(player.getTags().find(f => { return f.includes('{"dLang":') }) ?? '{"dLang":0}')
    const menu = new ModalFormData().title(`${kUI}§g§f${translation(dLang, "fishg")}`)
        .textField(`${p.error ? `§c` : `§f`}${translation(dLang, "fishSpot")}`, `x y z`, p.fishingSpot ?? `${Math.floor(drone.location.x)} ${Math.floor(drone.location.y)} ${Math.floor(drone.location.z)}`)
        .slider(`§f${translation(dLang, "rdbls")}`, 4, 32, 1, p.radius ?? 8)
        .textField(`§f${translation(dLang, "ciwbs")} §g(${translation(dLang, "optio")})`, `x y z`, p.container ?? getContainer(drone.location, drone.dimension))
        .toggle(`§f${translation(dLang, "fppsr")}`, p.followPlayer)

    p.antenna = (drone.typeId === "drone:antenna")
    menu.show(player).then(r => {
        if (!r.canceled) {
            let fishingSpot = r.formValues[0].match(/-?\d+/g)
            let chest = r.formValues[2].match(/-?\d+/g)

            if (r.formValues[3] || (fishingSpot && fishingSpot.length >= 3)) {
                deleteTasks(drone, { drones: p.drones })

                if (!r.formValues[3]) {
                    fishingSpot.forEach((f, i) => { fishingSpot[i] = parseInt(f) })
                }
                if (chest && chest.length >= 3) chest.forEach((f, i) => { chest[i] = parseInt(f) })

                for (const dron of p.drones ?? [drone]) {
                    let data = {
                        task: `fishg`,
                        taskID: 11,
                        fishingSpot: r.formValues[3] ? [] : fishingSpot,
                        radius: r.formValues[1],
                        chest: chest ? chest : [],
                        followPlayer: r.formValues[3],
                        playerID: player.id
                    }
                    dron.addTag(JSON.stringify(data))
                    dron.getComponent('minecraft:mark_variant').value = 11
                    dron.addTag(JSON.stringify({ taskUniqueID: `${Math.random()}` }))
                    executeTasks(dron, 11, { firstCall: true })
                }
                if (p.antenna) radiiAndTicks(drone, player)
            }
            else fishing(drone, player, {
                error: true,
                fishingSpot: r.formValues[0],
                radius: r.formValues[1],
                container: r.formValues[2],
                followPlayer: r.formValues[3],
                drones: p.drones
            })
        }
        else p.backToMain ? p.antenna ? antennaMenu({ entity: drone, player }) : droneMenu({ target: drone, player }, p) : droneTasks(drone, player, p)
    })
}

export function illuminateArea(drone, player, p = {}) {
    const { dLang } = JSON.parse(player.getTags().find(f => { return f.includes('{"dLang":') }) ?? '{"dLang":0}')
    const menu = new ModalFormData().title(`${kUI}§g§f${translation(dLang, "illArea")}`)
        .textField(`${p.error ? `§c` : `§f`}${translation(dLang, "src")}`, `x y z`, p.center ?? `${Math.floor(drone.location.x)} ${Math.floor(drone.location.y)} ${Math.floor(drone.location.z)}`)
        .slider(`§f${translation(dLang, "lightRadius")}`, 4, 64, 1, p.radius ?? 16)
        .slider(`§f${translation(dLang, "lightLevel")}`, 8, 15, 1, p.lightLevel ?? 12)
        .dropdown(`§f${translation(dLang, "torchType")}`, ["minecraft:torch", "minecraft:soul_torch", "minecraft:redstone_torch", "minecraft:lantern", "minecraft:soul_lantern"], p.torchType ?? 0)
        .textField(`§f${translation(dLang, "ciwbs")} §g(${translation(dLang, "optio")})`, `x y z`, p.container ?? getContainer(drone.location, drone.dimension))
        .toggle(`§f${translation(dLang, "fppsr")}`, p.followPlayer)

    p.antenna = (drone.typeId === "drone:antenna")
    menu.show(player).then(r => {
        if (!r.canceled) {
            let center = r.formValues[0].match(/-?\d+/g)
            let chest = r.formValues[4].match(/-?\d+/g)

            if (r.formValues[5] || (center && center.length >= 3)) {
                deleteTasks(drone, { drones: p.drones })

                if (!r.formValues[5]) {
                    center.forEach((f, i) => { center[i] = parseInt(f) })
                }
                if (chest && chest.length >= 3) chest.forEach((f, i) => { chest[i] = parseInt(f) })

                const torchTypes = ["minecraft:torch", "minecraft:soul_torch", "minecraft:redstone_torch", "minecraft:lantern", "minecraft:soul_lantern"]

                for (const dron of p.drones ?? [drone]) {
                    let data = {
                        task: `illArea`,
                        taskID: 12,
                        center: r.formValues[5] ? [] : center,
                        radius: r.formValues[1],
                        lightLevel: r.formValues[2],
                        torchType: torchTypes[r.formValues[3]],
                        chest: chest ? chest : [],
                        followPlayer: r.formValues[5],
                        playerID: player.id
                    }
                    dron.addTag(JSON.stringify(data))
                    dron.getComponent('minecraft:mark_variant').value = 12
                    dron.addTag(JSON.stringify({ taskUniqueID: `${Math.random()}` }))
                    executeTasks(dron, 12, { firstCall: true })
                }
                if (p.antenna) radiiAndTicks(drone, player)
            }
            else illuminateArea(drone, player, {
                error: true,
                center: r.formValues[0],
                radius: r.formValues[1],
                lightLevel: r.formValues[2],
                torchType: r.formValues[3],
                container: r.formValues[4],
                followPlayer: r.formValues[5],
                drones: p.drones
            })
        }
        else p.backToMain ? p.antenna ? antennaMenu({ entity: drone, player }) : droneMenu({ target: drone, player }, p) : droneTasks(drone, player, p)
    })
}


export function selectInfo(p) {
    for (const player of p ?? world.getAllPlayers()) {
        const tag = player.getTags().find(f => { return f.includes('{"selectMode":t') })
        const { dLang } = JSON.parse(player.getTags().find(f => { return f.includes('{"dLang":') }) ?? '{"dLang":0}')
        if (tag) {
            let { from, to } = JSON.parse(tag)

            const info = !from.includes("§N") && !to.includes("§N") ? `§7${translation(dLang, "iwdas")}` : `§7${translation(dLang, "bbtsl")}`
            player.onScreenDisplay.setActionBar(`${translation(dLang, "selMd")} \n§6${translation(dLang, "from")}: §9[${from}]  §6${translation(dLang, "to")}: §9[${to}]\n${info}`)

            if (from.includes("§N")) return

            from = from.split(",")
            to = to.includes("§N") ? from : to.split(",")

            from.forEach((f, i) => { from[i] = parseInt(f) })
            to.forEach((f, i) => { to[i] = parseInt(f) })

            const [fromX, fromY, fromZ] = from
            const [toX, toY, toZ] = to

            let minX = Math.min(fromX, toX)
            let maxX = Math.max(fromX, toX) + 1
            let minY = Math.min(fromY, toY)
            let maxY = Math.max(fromY, toY) + 1
            let minZ = Math.min(fromZ, toZ)
            let maxZ = Math.max(fromZ, toZ) + 1

            for (let x = minX; x <= maxX; x++) {
                for (let y = minY; y <= maxY; y++) {
                    for (let z = minZ; z <= maxZ; z++) {
                        if ((x === minX || x === maxX) && (y === minY || y === maxY) || (x === minX || x === maxX) && (z === minZ || z === maxZ) || (y === minY || y === maxY) && (z === minZ || z === maxZ)) {
                            try { player.dimension.spawnParticle("select:border", { x, y, z }, new MolangVariableMap()) } catch (e) { }
                        }
                    }
                }
            }
        }
    }
}