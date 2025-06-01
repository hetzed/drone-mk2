import { world, system, EasingType, ItemStack } from "@minecraft/server"
import { ActionFormData, ModalFormData } from "@minecraft/server-ui"
import { moveSystem } from "./moveSystem"
import { deleteTasks, executeTasks, harvestable, unbreakableBlocks } from "./executeTasks"
import { confLang, langs, translation } from "./translation"
import * as tasks from "./tasksSettings"

export const kUI = "§e§f§f§e§c§t§U§I§d§r§0§n§e"

//system.beforeEvents.watchdogTerminate.subscribe(s => { s.cancel = true; })

world.afterEvents.entityHealthChanged.subscribe(e => {
    const bot = e.entity
    if (bot.typeId === "effect99:drone" && e.newValue < 1) destroyed(bot)
})

world.beforeEvents.worldInitialize.subscribe(i => {
    i.blockComponentRegistry.registerCustomComponent(`drone:antenna`, {
        onPlayerInteract: antennaControl
    })
    i.blockComponentRegistry.registerCustomComponent(`drone:packed`, {
        onPlayerInteract: packedInteract
    })
    i.blockComponentRegistry.registerCustomComponent(`despawn:block`, {
        onTick: function despawnBlock(i) {
            const { x, y, z } = i.block
            i.block.dimension.runCommand(`setblock ${x} ${y} ${z} air destroy`)
        }
    })
})

world.beforeEvents.itemUse.subscribe(i => { if (i.itemStack.typeId === "drone:remote_control") system.runTimeout(() => remoteControl(i.source)) })

function packedInteract(p) {
    p.block.setType("minecraft:air")
    const { x, y, z } = p.block
    const dimension = p.dimension

    const bot = dimension.spawnEntity('effect99:drone', { x: x + 0.5, y, z: z + 0.5 })
    dimension.spawnParticle("minecraft:large_explosion", { x: x + 1, y: y + 0.5, z })
    dimension.spawnParticle("minecraft:large_explosion", { x: x, y: y + 0.3, z })
    dimension.spawnParticle("minecraft:large_explosion", { x, y: y + 0.5, z: z + 1 })
    dimension.spawnParticle("minecraft:large_explosion", { x, y: y + 0.7, z: z })
    dimension.playSound("random.explode", bot.location, { pitch: 2 })
}

function antennaControl(a) {
    if (!a.player.getTags().some(f => { return f.includes('{"dLang":') })) {
        confLang(a.player, a, {}, antennaControl)
        return
    }
    const { x, y, z } = a.block
    const dimension = a.dimension

    let entity
    for (const antenna of dimension.getEntitiesAtBlockLocation({ x, y, z })) {
        if (antenna.typeId === 'drone:antenna') entity = antenna
    }
    if (!entity) entity = dimension.spawnEntity('drone:antenna', { x: x + 0.5, y: y + 0.5, z: z + 0.5 })

    entity.addTag(`DCA`)
    const owner = JSON.parse(entity.getTags().find(f => { return f.includes('{"owner":') }) ?? `{"id":"0"}`)
    if (owner.id === "0" || owner.id === a.player.id) antennaMenu({ entity, player: a.player })
    else {
        a.block.setPermutation(a.block.permutation.withState("block:deny", true))
        system.runTimeout(() => {
            try { a.block.setPermutation(a.block.permutation.withState("block:deny", false)) } catch (e) { }
        }, 10)
    }
}

world.afterEvents.playerInteractWithEntity.subscribe(i => {
    if (i.itemStack?.typeId === "drone:solar_panel") {
        i.target.triggerEvent("addSolarPanel")
        i.target.dimension.playSound("random.anvil_use", i.target.location, { pitch: 1.4 })
        i.player.getComponent("inventory").container.setItem(i.player.selectedSlotIndex, undefined)
    }
    else if (i.itemStack?.typeId === "minecraft:iron_ingot") {
        const { dLang } = JSON.parse(i.player.getTags().find(f => { return f.includes('{"dLang":') }) ?? '{"dLang":0}')
        if (!i.player.isSneaking) i.player.onScreenDisplay.setActionBar(translation(dLang, "sktrp"))
    }
    else if (i.target.typeId === "effect99:drone") {
        const owner = JSON.parse(i.target.getTags().find(f => { return f.includes('{"owner":') }) ?? `{"id":"0"}`)
        if (owner.id === "0" || owner.id === i.player.id) droneMenu(i)
        else {
            const state = i.target.getComponent('minecraft:variant').value
            if (state) i.target.playAnimation("animation.drone.walk_deny")
            else i.target.playAnimation("animation.drone.deny")
        }
    }
})

world.afterEvents.entitySpawn.subscribe(e => {
    if (e?.entity?.typeId === "effect99:drone") {
        e.entity.nameTag = "§f§d§r§0§n§e"
    }
})

//for (let i = 0; i < 54; i++) world.getAllPlayers()[0].runCommand(`replaceitem block ~ ~ ~ slot.container ${i} redstone 64`)
world.beforeEvents.playerBreakBlock.subscribe(b => tasks.selectMode(b))

function remoteControl(player, p = {}) {
    if (!player.getTags().some(f => { return f.includes('{"dLang":') })) {
        confLang(player, player, p, remoteControl)
        return
    }
    const { dLang } = JSON.parse(player.getTags().find(f => { return f.includes('{"dLang":') }) ?? '{"dLang":0}')
    const remoteDrone = new ActionFormData().title(`${kUI}§r§f${translation(dLang, "drc")}`).body(`§8${translation(dLang, "swarms")}`).button(`§h§i§d§e§f${translation(dLang, "cDSwa")}`, `textures/icons/create_swarm`)
    const swarmList = player.getTags().filter(f => { return f.includes('{"swarmName":"') })

    for (const swarm of swarmList) {
        remoteDrone.button(`${JSON.parse(swarm).swarmID === p.remark ? `§a` : `§h`} ${JSON.parse(swarm).swarmName}\n§8${translation(dLang, "drones")}: ${getSwarm(player.dimension, JSON.parse(swarm).swarmID, player.location).length}/${JSON.parse(swarm).amount}`, `textures/icons/swarm`)
    }

    remoteDrone.show(player).then(r => {
        if (!r.canceled) {
            if (r.selection === 0) {
                const createSwarm = new ModalFormData().title(`${kUI}§g§f${translation(dLang, "cDSwa")}`).textField(`\n§f${translation(dLang, "sName")}:`, ``)

                createSwarm.show(player).then(r => {
                    if (!r.canceled) {
                        if (r.formValues[0].length) {
                            const swarmID = `${Math.random()}`.replace(".", "F")
                            player.addTag(JSON.stringify({ swarmName: r.formValues[0], swarmID, amount: 0 }))
                            remoteControl(player, { remark: swarmID })
                        }
                    }
                    else remoteControl(player)
                })
            }
            else if (r.selection) {
                let playerData = swarmList[r.selection - 1]

                function swarmOptions(p = {}) {
                    const { swarmName, amount, swarmID } = JSON.parse(playerData)
                    const swarmMenu = new ActionFormData().title(`${kUI}§s§f${translation(dLang, "dSwrm")}`).body(`§8${translation(dLang, "swarm")}: ${swarmName}  ${translation(dLang, "drones")}: ${getSwarm(player.dimension, swarmID, player.location).length}/${amount}`)
                        .button(`§h${translation(dLang, "dOpts")}`, `textures/icons/options`)
                        .button(`§h${translation(dLang, "seleD")}`, `textures/icons/select_drone`)
                        .button(`§h${translation(dLang, "addd")}${p.noDrones ?? ``}`, `textures/icons/add_drone`)
                        .button(`§h${translation(dLang, "deleD")}${p.emptySwarm ?? ``}`, `textures/icons/delete_drone`)
                        .button(`§h${translation(dLang, "deleS")}\n§b${swarmName}`, `textures/icons/remove_swarm`)

                    swarmMenu.show(player).then(s => {
                        if (!s.canceled) {
                            if (s.selection === 0) {
                                const playerSwarmID = JSON.parse(swarmList[r.selection - 1]).swarmID
                                const drones = getSwarm(player.dimension, playerSwarmID, player.location)
                                if (!drones[0]) { player.onScreenDisplay.setActionBar(translation(dLang, "dofr")); return }
                                droneMenu({ target: {}, player }, { drones })
                            }
                            if (s.selection === 1) {
                                const { swarmName } = JSON.parse(playerData)
                                const playerSwarmID = JSON.parse(swarmList[r.selection - 1]).swarmID
                                const drones = getSwarm(player.dimension, playerSwarmID, player.location)
                                if (!drones[0]) { player.onScreenDisplay.setActionBar(translation(dLang, "dofr")); return }

                                const selectDron = new ActionFormData().title(`${kUI}§t§f${translation(dLang, "drones")}`).body(`§8${translation(dLang, "swarm")}: ${swarmName}`)
                                for (const dron of drones) {
                                    const data = dron.getTags()
                                    let { dName } = JSON.parse(data.find(f => { return f.includes('{"dName":"') }) ?? '{"dName":"unknown"}')
                                    const { battery } = JSON.parse(data.find(f => { return f.includes('{"battery":') }) ?? '{"battery":100}')
                                    selectDron.button(`§h${dName}\n§8${translation(dLang, "batt")}: ${battery}`, `textures/icons/drone`)
                                }
                                selectDron.show(player).then(d => {
                                    if (!d.canceled) {
                                        droneMenu({ target: drones[d.selection], player }, { rRemote: true })
                                    }
                                    else swarmOptions(p)
                                })
                            }
                            else if (s.selection === 2) {
                                addDrone()
                                function addDrone() {
                                    const { swarmName, amount, swarmID } = JSON.parse(playerData)
                                    const addMenu = new ActionFormData().title(`${kUI}§h§f${translation(dLang, "addd")}`).body(`§8${swarmName}\n§7${translation(dLang, "ndws")}`)
                                    const drones = []

                                    for (const drone of player.dimension.getEntities({ type: "effect99:drone" })) {
                                        if (!drone.getTags().find(f => { return f.includes('{"swarmID":"') })) {
                                            const owner = JSON.parse(drone.getTags().find(f => { return f.includes('{"owner":') }) ?? `{"id":"0"}`)
                                            if (owner.id != "0" && owner.id != player.id) continue

                                            let droneName = drone.getTags().find(f => { return f.includes('{"dName":"') })
                                            if (!droneName) {
                                                droneName = JSON.stringify({ dName: `APD-B${drone.id.slice(drone.id.length - 3, drone.id.length)}`, show: 0 })
                                                drone.addTag(droneName)
                                            }
                                            if (!drone.getTags().find(f => { return f.includes('{"battery":') })) {
                                                drone.addTag(JSON.stringify({ battery: 100 }))
                                            }
                                            addMenu.button(`§7${JSON.parse(droneName).dName}\n§a${translation(dLang, "add")}`, `textures/icons/drone`)
                                            drones.push(drone)
                                        }
                                    }
                                    if (!drones[0]) { swarmOptions({ noDrones: `\n§g${translation(dLang, "tandn")}` }); return }
                                    addMenu.show(player).then(d => {
                                        if (!d.canceled) {
                                            player.removeTag(player.getTags().find(f => { return f.includes(swarmID) }))
                                            player.addTag(JSON.stringify({ swarmName, swarmID, amount: amount + 1 }))
                                            drones[d.selection].addTag(JSON.stringify({ swarmID, playerID: player.id }))
                                            playerData = player.getTags().find(f => { return f.includes(swarmID) })
                                            addDrone()
                                        }
                                        else swarmOptions()
                                    })
                                }
                            }
                            else if (s.selection === 3) {
                                removeDrone()
                                function removeDrone() {
                                    const { swarmName, amount, swarmID } = JSON.parse(playerData)
                                    const removeMenu = new ActionFormData().title(`${kUI}§h§f${translation(dLang, "deleD")}`).body(`§8${swarmName}\n§7${translation(dLang, "ndbts")}`)
                                    const drones = []

                                    for (const drone of player.dimension.getEntities({ type: "effect99:drone" })) {
                                        const tag = drone.getTags().find(f => { return f.includes(swarmID) })
                                        if (tag) {
                                            let droneName = drone.getTags().find(f => { return f.includes('{"dName":"') })
                                            if (!droneName) {
                                                droneName = JSON.stringify({ dName: `APD-B${drone.id.slice(drone.id.length - 3, drone.id.length)}`, show: 0 })
                                                drone.addTag(droneName)
                                            }
                                            if (!drone.getTags().find(f => { return f.includes('{"battery":') })) {
                                                drone.addTag(JSON.stringify({ battery: 100 }))
                                            }
                                            removeMenu.button(`§7${JSON.parse(droneName).dName}\n§c${translation(dLang, "remov")}`, `textures/icons/drone`)
                                            drones.push({ drone, tag })
                                        }
                                    }
                                    if (!drones[0]) { swarmOptions({ emptySwarm: `\n§c${translation(dLang, "tndts")}` }); return }
                                    removeMenu.show(player).then(d => {
                                        if (!d.canceled) {
                                            player.removeTag(player.getTags().find(f => { return f.includes(swarmID) }))
                                            player.addTag(JSON.stringify({ swarmName, swarmID, amount: amount - 1 }))
                                            drones[d.selection].drone.removeTag(drones[d.selection].tag)
                                            playerData = player.getTags().find(f => { return f.includes(swarmID) })
                                            removeDrone()
                                        }
                                        else swarmOptions()
                                    })
                                }
                            }
                            else if (s.selection === 4) {
                                player.removeTag(swarmList[r.selection - 1])
                            }
                        }
                        else remoteControl(player)
                    })
                }
                swarmOptions()
            }
        }
    })
}

function getSwarm(dimension, swarmID, location) {
    const drones = []
    for (const drone of dimension.getEntities({ type: "effect99:drone", location })) {
        const droneSwarmID = JSON.parse(drone.getTags().find(f => { return f.includes('{"swarmID":"') }) ?? `{"swarmID":"0"}`).swarmID
        if (droneSwarmID === swarmID) {
            drones.push(drone)
        }
    }
    return drones
}

export function antennaMenu(i, p = {}) {
    const antenna = i.entity
    p.antenna = true

    const selectData = i.player.getTags().find(f => { return f.includes('{"selectMode":t') })
    let { selectMode, from, to, taskID: sTaskID } = JSON.parse(selectData ?? '{"selectMode":false}')
    if (selectMode) {
        system.runTimeout(() => {
            if (to.includes("§N")) to = from
            if (sTaskID === 1) tasks.mineALocation(antenna, i.player, { from: from.replace(/,/g, " "), to: to.replace(/,/g, " ") })
            else if (sTaskID === 3) tasks.fillLocation(antenna, i.player, { from: from.replace(/,/g, " "), to: to.replace(/,/g, " ") })
            i.player.removeTag(selectData)
        })
        return
    }
    const { dLang } = JSON.parse(i.player.getTags().find(f => { return f.includes('{"dLang":') }) ?? '{"dLang":0}')
    let taskSettings = JSON.parse(antenna.getTags().find(f => { return f.includes('{"task":"') }) ?? `{"task":"none"}`)
    const { task, taskID } = taskSettings

    let antennaName = antenna.getTags().find(f => { return f.includes('{"dName":"') })
    if (!antennaName) {
        antennaName = JSON.stringify({ dName: `DCA-${antenna.id.slice(antenna.id.length - 3, antenna.id.length)}`, show: false })
        antenna.addTag(antennaName)
    }

    const remoteDrone = new ActionFormData().title(`${kUI}§a§f${translation(dLang, "dca")}`).body(`§8§‰ ${JSON.parse(antennaName).dName} ${translation(dLang, "onlin")}`)
        .button(`§8< §h${translation(dLang, "cTask")} §8> \n§a${translation(dLang, task)}`, `textures/icons/current_task`)
        .button(`§8< §h${translation(dLang, "tasks")} §8>\n${taskID ? `§c${translation(dLang, "lock")}` : ``}`, `textures/icons/tasks`)
        .button(`§8< §h${translation(dLang, "sTask")} §8>\n${taskID ? `§c${translation(dLang, "lock")}` : ``}`, `textures/icons/simple_task`)
        .button(`§8< §h${translation(dLang, "aStts")} §8>`, `textures/icons/settings`)

    remoteDrone.show(i.player).then(r => {
        if (!r.canceled) {
            if (r.selection === 0 && (taskID || taskID === 0)) {
                const currentTask = new ActionFormData().title(`${kUI}§c§f${translation(dLang, "cTask")}`).button(`§8< §f${translation(dLang, task)} §8>`, `textures/icons/tasks_list`)
                    .button(`§8< ${taskID === -1 ? `§f${translation(dLang, "clTsks")}` : `§f${translation(dLang, "clTask")}`} §8>`)
                currentTask.show(i.player).then(c => {
                    if (!c.canceled) {
                        if (c.selection === 0) {
                            currenTask(antenna, i, taskID, taskSettings, p)
                        }
                        else if (c.selection === 1) {
                            deleteTasks(antenna)
                            antennaMenu(i, p)
                        }
                    }
                    else antennaMenu(i, p)
                })
            }
            else if (r.selection === 1) {
                if (taskID) { antennaMenu(i, p); return }
                droneTasks(antenna, i.player, p)
            }
            else if (r.selection === 2) {
                if (taskID) { antennaMenu(i, p); return }
                simpleDroneTasks(antenna, i.player, p)
            }
            else if (r.selection === 3) {
                p.name = antennaName
                antennaSetts(i, antenna, p)
            }
            else antennaMenu(i, p)
        }
    })
}

export function droneMenu(i, p = {}) {
    if (!i.player.getTags().some(f => { return f.includes('{"dLang":') })) {
        confLang(i.player, i, p, droneMenu, i.target)
    }
    else if (p.drones || (i.target.typeId === "effect99:drone" && i.target.hasTag("initSystem"))) {
        const drone = p.drones ? p.drones[0] : i.target
        const state = drone.getComponent('minecraft:variant').value
        i.player.removeTag("selectCooldown")

        const selectData = i.player.getTags().find(f => { return f.includes('{"selectMode":t') })
        let { selectMode, droneId, from, to, taskID: sTaskID, swarm } = JSON.parse(selectData ?? '{"selectMode":false}')
        if (swarm) p.drones = getSwarm(i.player.dimension, droneId, i.player.location)

        const swarmID = p.drones ? JSON.parse(drone.getTags().find(f => { return f.includes('{"swarmID":"') }) ?? '{"swarmID":"F"}').swarmID : undefined
        const { swarmName, amount } = JSON.parse(i.player.getTags().find(f => { return f.includes(swarmID) }) ?? '{"swarmName":""}')
        if (p.drones && !swarmName.length) {
            if (state) playAnimation("animation.drone.walk_deny")
            else playAnimation("animation.drone.deny")
            return
        }
        if (selectMode && droneId === (swarmID ?? drone.id)) {
            for (const dron of p.drones ?? [drone]) {
                dron.getComponent('minecraft:skin_id').value = 0
            }
            system.runTimeout(() => {
                if (to.includes("§N")) to = from
                if (sTaskID === 1) tasks.mineALocation(drone, i.player, { from: from.replace(/,/g, " "), to: to.replace(/,/g, " "), drones: p.drones })
                else if (sTaskID === 3) tasks.fillLocation(drone, i.player, { from: from.replace(/,/g, " "), to: to.replace(/,/g, " "), drones: p.drones })
                else if (sTaskID === 9) tasks.removeLiquids(drone, i.player, { from: from.replace(/,/g, " "), to: to.replace(/,/g, " "), drones: p.drones })
                i.player.removeTag(selectData)
            })
            return
        } else if (selectMode) {
            if (state) drone.playAnimation("animation.drone.walk_deny")
            else drone.playAnimation("animation.drone.deny")
            return
        }
        const { dLang } = JSON.parse(i.player.getTags().find(f => { return f.includes('{"dLang":') }) ?? '{"dLang":0}')
        let taskSettings = JSON.parse(drone.getTags().find(f => { return f.includes('{"task":"') }) ?? `{"task":"none"}`)
        let taskMatch = drone.getTags().find(f => { return f.includes('{"task":"') })
        for (const dron of p.drones ?? [drone]) {
            let allTasks = dron.getTags().find(f => { return f.includes('{"task":"') })
            if (allTasks != taskMatch) {
                taskSettings = { task: `difT`, taskID: 0 }
                break
            }
        }
        const { task, taskID } = taskSettings
        const followPlayer = drone.getTags().find(f => { return f.includes('{"followPlayer":t') }) ?? '{"name":""}'

        let droneName = drone.getTags().find(f => { return f.includes('{"dName":"') })
        if (!droneName && !p.drones) {
            droneName = JSON.stringify({ dName: `APD-B${drone.id.slice(drone.id.length - 3, drone.id.length)}`, show: 0 })
            drone.addTag(droneName)
        }
        let battery = drone.getTags().find(f => { return f.includes('{"battery":') })
        if (!battery && !p.drones) {
            battery = JSON.stringify({ battery: 100 })
            drone.addTag(battery)
        }
        const batteryVal = (p.drones ? 101 : JSON.parse(battery).battery)
        const inWalk = drone.getComponent("minecraft:variant").value

        const remoteDrone = new ActionFormData().title(`${kUI}§m§r§f${translation(dLang, "apd")}`).body(`§8${p.drones ? `${translation(dLang, "swarm")}: ${swarmName}` : JSON.parse(droneName).dName} ${p.drones ? `` : `${batteryVal <= 10 ? `§c` : `§8`} ${translation(dLang, "batt")}: ${batteryVal}‰`}`)
            .button(`§8< §h${translation(dLang, "cTask")} §8> \n§a${translation(dLang, task)}`, `textures/icons/current_task`)
            .button(`§8< §h${translation(dLang, "tasks")} §8>\n${taskID ? `§c${translation(dLang, "lock")}` : ``}`, `textures/icons/tasks`)
            .button(`§8< §h${translation(dLang, "sTask")} §8>\n${taskID ? `§c${translation(dLang, "lock")}` : ``}`, `textures/icons/simple_task`)
            .button(`§8< §h${!JSON.parse(followPlayer).name.length ? translation(dLang, "fplay") : translation(dLang, "uplay")} §8>${taskID ? `\n§c${translation(dLang, "lock")}` : ``} §a${JSON.parse(followPlayer).name}`, `textures/icons/follow_player`)
            .button(`${inWalk ? `§8${batteryVal <= 0 ? `§c${translation(dLang, "lock")}` : `§8${translation(dLang, "fMode")}`}\n§8< §h${translation(dLang, "wMode")} §8>` : `§8< §h${translation(dLang, "fMode")} §8>\n${translation(dLang, "wMode")}`}`, inWalk ? `textures/icons/walk_mode` : `textures/icons/drone`)
            .button(`§8< §h${translation(dLang, "dCam")} §8>${batteryVal <= 0 ? `\n§c${translation(dLang, "lock")}` : ``}`, `textures/icons/camera`)
            .button(`§8< §h${translation(dLang, "setts")} §8>`, `textures/icons/settings`)
            .button(`§8< §c${translation(dLang, "selfD")} §8>`, `textures/icons/self_destruct`)

        remoteDrone.show(i.player).then(r => {
            if (!r.canceled) {
                if (r.selection === 0 && (taskID || taskID === 0)) {
                    const currentTask = new ActionFormData().title(`${kUI}§c§f${translation(dLang, "cTask")}`).button(`§8< §7${translation(dLang, task)} §8>`, `textures/icons/tasks_list`)
                        .button(`§8< ${taskID === -1 ? `§7${translation(dLang, "clTsks")}` : `§7${translation(dLang, "clTask")}`} §8>`)
                    currentTask.show(i.player).then(c => {
                        if (!c.canceled) {
                            if (c.selection === 0) {
                                currenTask(drone, i, taskID, taskSettings, { drones: p.drones })
                            }
                            else if (c.selection === 1) {
                                deleteTasks(drone, { drones: p.drones }, true)
                                droneMenu(i, p)
                            }
                        }
                    })
                }
                else if (r.selection === 1) {
                    if (taskID) { droneMenu(i, p); return }
                    droneTasks(drone, i.player, { drones: p.drones })
                }
                else if (r.selection === 2) {
                    if (taskID) { droneMenu(i, p); return }
                    simpleDroneTasks(drone, i.player, { drones: p.drones })
                }
                else if (r.selection === 3 && !taskID) {
                    if (!JSON.parse(followPlayer).name.length) {
                        for (const dron of p.drones ?? [drone]) {
                            deleteTasks(dron)
                            system.runTimeout(() => {
                                dron.removeTag("RuntimeOut")
                                moveSystem(dron, { location: i.player.location, followPlayer: true, radius: p.drones ? 12 : 4 })
                                dron.addTag(JSON.stringify({ followPlayer: true, playerID: i.player.id, name: `\n${i.player.name}`, swarm: !!p.drones }))
                            }, 5)
                        }
                    }
                    else {
                        for (const dron of p.drones ?? [drone]) dron.removeTag(followPlayer)
                        droneMenu(i, p)
                    }
                }
                else if (r.selection === 4 && batteryVal > 0) {
                    for (const dron of p.drones ?? [drone]) {
                        if (JSON.parse(dron.getTags().find(f => { return f.includes('{"battery":') }) ?? '{"battery":100}').battery < 10) continue
                        dron.getComponent("minecraft:variant").value ? dron.triggerEvent("flyMode") : dron.triggerEvent("walkMode")
                    }
                    system.runTimeout(() => { droneMenu(i, p) }, 1)
                }
                else if (r.selection === 5) {
                    for (const dron of p.drones ? p.drones.sort(() => Math.random() - 0.5) : [drone]) {
                        if (JSON.parse(dron.getTags().find(f => { return f.includes('{"battery":') }) ?? '{"battery":100}').battery > 0) {
                            i.player.addTag("CameraOut")
                            system.runTimeout(() => {
                                i.player.removeTag("CameraOut")
                                dron.removeTag("RuntimeOut")
                                droneCamera(dron, i.player, { dLang })
                            }, 2)
                            break
                        }
                        else droneMenu(i, p)
                    }
                }
                else if (r.selection === 6) {
                    p.batteryVal = batteryVal
                    settings(i, drone, p)
                }
                else if (r.selection === 7) {
                    const mForm = new ActionFormData().title(`${kUI}§s`).body(`${translation(dLang, "desDro")} ?`)

                    mForm.button(`§f${translation(dLang, "yes")}`).button(`§h§i§d§e`).button(`§f${translation(dLang, "noo")}`)
                    mForm.show(i.player).then(m => {
                        if (!m.canceled) {
                            if (m.selection === 0) for (const dron of p.drones ?? [drone]) destroyed(dron)
                            else droneMenu(i, p)
                        }
                    })
                }
                else droneMenu(i, p)
            }
            else p.drones || p.rRemote ? remoteControl(i.player) : 0
        })
    }
    else {
        let bot = (p.drones ? p.drones[0] : i.target)
        if (bot.getComponent('minecraft:variant').value) bot.playAnimation("animation.drone.walk_deny")
        else bot.playAnimation("animation.drone.deny")
    }
}

function settings(i, drone, p = {}) {
    const tagSett = drone.getTags().find(f => { return f.includes('{"sttA":') }) ?? `{}`
    const tagOwner = drone.getTags().find(f => { return f.includes('{"owner":') }) ?? `{}`
    const { id } = JSON.parse(tagOwner)
    const { dName, show } = JSON.parse(drone.getTags().find(f => { return f.includes('{"dName":') }) ?? `{"dName":""}`)
    const { dLang } = JSON.parse(i.player.getTags().find(f => { return f.includes('{"dLang":') }) ?? '{"dLang":0}')
    const { sttA, sttB, sttC, sttE, sttF, sttG, sttH, sttI } = JSON.parse(tagSett)

    let index = 1
    let selected = 0
    const players = [{ name: `§7${translation(dLang, "wOwnr")}`, id: "0", index: 0 }]
    for (const player of world.getAllPlayers()) {
        players.push({ name: player.name, id: player.id, index })
        index++
    }
    const ind = players.findIndex(f => { return f.id == id })
    if (ind > 0) selected = ind

    const menu = new ModalFormData().title(`${kUI}§g§f${p.drones ? translation(dLang, "sStts") : translation(dLang, "setts")}`)
        .textField(`${p.error ? `§c` : `§f`}${translation(dLang, "crLoc")}`, "x y z", p.sttA ?? sttA)
        .toggle(translation(dLang, "gRLoc"), sttB)
        .textField(`${p.drones ? `§c` : `§f`}${translation(dLang, "dName")}`, p.drones ? translation(dLang, "lcSSt") : dName, p.drones ? `` : dName)
        .toggle(`${translation(dLang, "sONam")} §8${translation(dLang, "vName")}`, sttC)
        .toggle(`${translation(dLang, "sBPer")}\n§8${translation(dLang, "vName")}`, sttE)
        .dropdown(`§f${translation(dLang, "nVisy")}`, [translation(dLang, "dnotS"), translation(dLang, "parSh"), translation(dLang, "alwSh")], show)
        .toggle(translation(dLang, "ttPla"), sttF ?? true)
        .slider(translation(dLang, "mDttP"), 5, 50, 1, sttG ?? 15)
        .dropdown(translation(dLang, "dOwne"), players.map(f => f.name), selected)
        .toggle(translation(dLang, "aFMod"), sttH)
        .dropdown(translation(dLang, "langu"), langs, dLang)
        .toggle(translation(dLang, "doutl"), drone.getProperty("outline:display"))
        .dropdown(translation(dLang, "outCo"), [translation(dLang, "cusCo"), translation(dLang, "black"), translation(dLang, "white"), translation(dLang, "red"), translation(dLang, "blue"), translation(dLang, "yellw"), translation(dLang, "green"), translation(dLang, "purpl"), translation(dLang, "orang"), translation(dLang, "pink"), translation(dLang, "dBlue"), "RGB", translation(dLang, "xpOrb"), translation(dLang, "tDete")], drone.getProperty("outline:default"))
        .textField(`${p.rgbError ? `§c` : `§f`}${translation(dLang, "occlr")} §4R§aG§1B §i0...255`, `R G B`, p.rgb ?? `${sRGB(drone.getProperty("outline:color_r"), drone.getProperty("outline:color_g"), drone.getProperty("outline:color_b"), false).join(" ")}`)
        .toggle(translation(dLang, "tlwsk"), sttI)

    if (p.drones) menu.dropdown(`\n§c${translation(dLang, "tSttF")} §f${dName}§c ${translation(dLang, "dIfSt")}`, [translation(dLang, "sStts")])

    menu.show(i.player).then(r => {
        if (!r.canceled) {
            let coords = r.formValues[0].match(/-?\d+/g)
            if ((coords && coords.length >= 3) || !r.formValues[0].length) {
                const [x, y, z] = coords ?? []

                for (const dron of p.drones ?? [drone]) {
                    const tagSett = dron.getTags().find(f => { return f.includes('{"sttA":') }) ?? `{}`

                    dron.removeTag(tagOwner)
                    dron.removeTag(tagSett)
                    dron.addTag(JSON.stringify({ owner: players[r.formValues[8]].name, id: players[r.formValues[8]].id }))
                    dron.addTag(JSON.stringify({ sttA: [x, y, z].join(" ").trim(), sttB: r.formValues[1], sttC: r.formValues[3], sttE: r.formValues[4], sttF: r.formValues[6], sttG: r.formValues[7], sttH: r.formValues[9], sttI: r.formValues[14] }))

                    const data = dron.getTags()
                    const tagName = data.find(f => { return f.includes('{"dName":') }) ?? `{"dName":""}`
                    const { dName } = JSON.parse(tagName)
                    const name = r.formValues[2].length > 2 && !p.drones ? r.formValues[2] : dName

                    dron.removeTag(tagName)
                    dron.addTag(JSON.stringify({ dName: name, show: r.formValues[5] }))

                    let { battery } = JSON.parse(data.find(f => { return f.includes('{"battery":') }) ?? '{"battery":100}')
                    let nameData = name + (r.formValues[3] ? `\n§5Owner: ${players[r.formValues[8]].name}` : ``) + (r.formValues[4] ? `\n§aBattery: ${battery}%` : ``)
                    switch (r.formValues[5]) {
                        case 0: dron.triggerEvent("do_not_show"); dron.nameTag = "§f§d§r§0§n§e§f"; break
                        case 1: dron.triggerEvent("name_partially_show"); dron.nameTag = `§f§d§r§0§n§e§f${nameData}`; break
                        case 2: dron.triggerEvent("name_always_show"); dron.nameTag = `§f§d§r§0§n§e§f${nameData}`; break
                    }
                    const { dLang } = JSON.parse(data.find(f => { return f.includes('{"dLang":') }) ?? '{"dLang":0}')
                    dron.removeTag(`{"dLang":${dLang}}`)
                    dron.addTag(JSON.stringify({ dLang: r.formValues[10] }))

                    dron.setProperty("outline:display", r.formValues[11])
                    dron.setProperty("outline:default", r.formValues[12])

                    const rgb = r.formValues[13].match(/-?\d+/g)
                    if (!r.formValues[12] && rgb && rgb.length >= 3) {
                        rgb.forEach((f, i) => { rgb[i] = parseInt(f) })
                        const [cR, cG, cB] = rgb
                        const { r: nR, g: nG, b: nB } = sRGB(cR, cG, cB)

                        dron.setProperty("outline:color_r", nR)
                        dron.setProperty("outline:color_g", nG)
                        dron.setProperty("outline:color_b", nB)
                    }
                    else if (r.formValues[12]) {
                        if (r.formValues[12] <= 10) {
                            dron.setProperty("outline:color_r", defaultColors[r.formValues[12] - 1].r)
                            dron.setProperty("outline:color_g", defaultColors[r.formValues[12] - 1].g)
                            dron.setProperty("outline:color_b", defaultColors[r.formValues[12] - 1].b)
                        }
                    }
                    else if (rgb) {
                        p.rgbError = true
                        p.rgb = r.formValues[13]
                        settings(i, drone, p)
                        return
                    }
                }
                i.player.removeTag(`{"dLang":${dLang}}`)
                i.player.addTag(JSON.stringify({ dLang: r.formValues[10] }))
                droneMenu(i, p)
            }
            else {
                p.error = true
                p.sttA = r.formValues[0]
                settings(i, drone, p)
            }
        }
        else droneMenu(i, p)
    })
}

function antennaSetts(i, antenna, p = {}) {
    const data = antenna.getTags()
    const { dLang } = JSON.parse(i.player.getTags().find(f => { return f.includes('{"dLang":') }) ?? '{"dLang":0}')
    const tagRadii = data.find(f => { return f.includes('{"scanRadius":') }) ?? `{"scanRadius":16}`
    const tagName = data.find(f => { return f.includes('{"dName":') }) ?? `{"dName":""}`
    const tagOwner = data.find(f => { return f.includes('{"owner":') }) ?? `{}`
    const inTasks = data.some(f => { return f.includes('{"task":"') })
    const { scanRadius, ticks } = JSON.parse(tagRadii)
    const { dName, show } = JSON.parse(tagName)
    const { id } = JSON.parse(tagOwner)

    let index = 1
    let selected = 0
    const players = [{ name: translation(dLang, "wOwnr"), id: "0", index: 0 }]
    for (const player of world.getAllPlayers()) {
        players.push({ name: player.name, id: player.id, index })
        index++
    }
    const ind = players.findIndex(f => { return f.id == id })
    if (ind > 0) selected = ind

    const menu = new ModalFormData().title(`${kUI}§g§f${translation(dLang, "aStts")}`)
        .slider(`§f${translation(dLang, "asr")}`, 4, 16, 1, scanRadius)
        .slider(`§f${translation(dLang, "eses")}`, 1, 10, 1, ticks ? ticks / 20 : 1)
        .textField(`§f${translation(dLang, "antNa")}`, dName, dName)
        .toggle(`§f${translation(dLang, "nVisi")}`, show)
        .dropdown(`§f${translation(dLang, "aOwnr")}:${inTasks ? `\n§c${translation(dLang, "ldTks")}!` : ``}`, players.map(f => f.name), selected)
        .dropdown(translation(dLang, "langu"), langs, dLang)

    menu.show(i.player).then(a => {
        if (!a.canceled) {
            antenna.removeTag(tagName)
            antenna.removeTag(tagRadii)

            if (!inTasks) {
                antenna.removeTag(tagOwner)
                antenna.addTag(JSON.stringify({ owner: players[a.formValues[4]].name, id: players[a.formValues[4]].id }))
            }
            const name = a.formValues[2].length > 2 ? a.formValues[2] : dName
            antenna.addTag(JSON.stringify({ dName: name, show: a.formValues[3] }))
            antenna.addTag(JSON.stringify({ scanRadius: a.formValues[0], ticks: a.formValues[1] * 20 }))

            if (a.formValues[3]) {
                antenna.triggerEvent("name_always_show")
                antenna.nameTag = name
            }
            else {
                antenna.triggerEvent("do_not_show")
                antenna.nameTag = ""
            }
            i.player.removeTag(`{"dLang":${dLang}}`)
            i.player.addTag(JSON.stringify({ dLang: a.formValues[5] }))

            const { dLang: lang } = JSON.parse(data.find(f => { return f.includes('{"dLang":') }) ?? '{"dLang":0}')
            antenna.removeTag(`{"dLang":${lang}}`)
            antenna.addTag(JSON.stringify({ dLang: a.formValues[5] }))
        }
        else antennaMenu(i, p)
    })
}

const droneCamera = (drone, player, p = {}) => system.runTimeout(() => {
    if (!drone || !drone.isValid || drone.hasTag("RuntimeOut") || player.isSneaking || player.hasTag("CameraOut")) {
        player.camera.clear()
        player.onScreenDisplay.setActionBar(`...`)
        return
    }
    player.onScreenDisplay.setActionBar(translation(p.dLang, "sTCam"))
    const { x, y, z } = drone.location
    const { x: px, y: py, z: pz } = (drone.dimension.getEntities({ type: "minecraft:player", maxDistance: 6, location: drone.location, closest: 1 })[0] ?? player).location

    const distance = Math.sqrt(((x - 0.5) - px) ** 2 + ((y - 0.5) - py) ** 2 + ((z - 0.5) - pz) ** 2)
    let yaw = Math.atan2(-(px - x), (pz - z)) * (180 / Math.PI)
    if (yaw < 0) yaw += 360

    drone.getComponent('minecraft:skin_id').value = 2
    drone.playAnimation("animation.drone.hide", { players: [player.name] })
    player.camera.setCamera(`minecraft:free`, { easeOptions: { easeTime: 0.1, easeType: EasingType.Linear }, location: { x, y: y + 0.7, z }, rotation: { x: drone.getRotation().x, y: distance <= 6 ? yaw : drone.getRotation().y } })
    droneCamera(drone, player, p)
}, 1)


function currenTask(drone, i, taskID, taskSett, p = {}) {
    if (taskID === 0) {
        droneMenu({ target: drone, player: i.player }, p)
    }
    else if (taskID === 1) {
        const { from, to, harvest, reload, chest } = taskSett
        const { bFilter } = JSON.parse(drone.getTags().find(f => { return f.includes('{"bFilter":[') }) ?? '{"bFilter":[]}')
        tasks.mineALocation(drone, i.player, { from: `${from}`.replace(/,/g, " "), to: `${to}`.replace(/,/g, " "), blocksFilter: bFilter.toString(), container: `${chest}`.replace(/,/g, " "), harvest, reload, backToMain: true, drones: p.drones })
    }
    else if (taskID === 2) {
        const { radiusCenter, radius, animals, monsters, aquaticMobs, flyMobs, avoidCreepers, ignorePets, followPlayer } = taskSett
        const { mFilter } = JSON.parse(drone.getTags().find(f => { return f.includes('{"mFilter":[') }) ?? '{"mFilter":[]}')
        tasks.killMobs(drone, i.player, { mobFilter: mFilter.toString().replace(/,/g, ", "), radiusCenter: radiusCenter.toString().replace(/,/g, " "), radius, animals, monsters, aquaticMobs, flyMobs, avoidCreepers, ignorePets, followPlayer, backToMain: true, drones: p.drones })
    }
    else if (taskID === 3) {
        let { from, to, chest, grow, reload } = taskSett
        if (grow) {
            from = [from[0], from[1] - 1, from[2]]
            to = [to[0], to[1] - 1, to[2]]
        }
        tasks.fillLocation(drone, i.player, { from: `${from}`.replace(/,/g, " "), to: `${to}`.replace(/,/g, " "), container: `${chest}`.replace(/,/g, " "), grow, reload, backToMain: true, drones: p.drones })
    }
    else if (taskID === 4) {
        const { coords, rad, minRad, animals, monsters, aquaticMobs, flyMobs } = taskSett
        const { mFilter } = JSON.parse(drone.getTags().find(f => { return f.includes('{"mFilter":[') }) ?? '{"mFilter":[]}')
        tasks.bringMobs(drone, i.player, { coords: `${coords}`.replace(/,/g, " "), mobFilter: mFilter.toString().replace(/,/g, ", "), animals, monsters, aquaticMobs, flyMobs, rad, minRad, backToMain: true, drones: p.drones })
    }
    else if (taskID === 5) {
        const { hScanRadius, vScanRadius, followPlayer } = taskSett
        const { bFilter } = JSON.parse(drone.getTags().find(f => { return f.includes('{"bFilter":[') }) ?? '{"bFilter":[]}')
        tasks.mineNearbyBlocks(drone, i.player, { blocksFilter: bFilter.toString().replace(/,/g, ", "), hScanRadius, vScanRadius, followPlayer, backToMain: true, drones: p.drones })
    }
    else if (taskID === 6) {
        const { center, chest, radius, followPlayer } = taskSett
        const { iFilter } = JSON.parse(drone.getTags().find(f => { return f.includes('{"iFilter":[') }) ?? '{"iFilter":[]}')
        tasks.collectItems(drone, i.player, { center: `${center}`.replace(/,/g, " "), chest: `${chest}`.replace(/,/g, " "), radius, followPlayer, itemsFilter: iFilter.toString().replace(/,/g, ", "), backToMain: true, drones: p.drones })
    }
    else if (taskID === 7) {
        const { ore, customOre, hScanRadius, vScanRadius, sound, playerID } = taskSett
        tasks.oreDetector(drone, i.player, { ore, customOre, hScanRadius, vScanRadius, sound, playerID, backToMain: true, drones: p.drones })
    }
    else if (taskID === 8) {
        const { contA, contB } = taskSett
        const { iFilter } = JSON.parse(drone.getTags().find(f => { return f.includes('{"iFilter":[') }) ?? '{"iFilter":[]}')
        tasks.moveItems(drone, i.player, { contA: `${contA}`.replace(/,/g, " "), contB: `${contB}`.replace(/,/g, " "), itemsFilter: iFilter.toString().replace(/,/g, ", "), backToMain: true, drones: p.drones })
    }
    else if (taskID === 9) {
        const { from, to, reload } = taskSett
        tasks.removeLiquids(drone, i.player, { from: `${from}`.replace(/,/g, " "), to: `${to}`.replace(/,/g, " "), reload, backToMain: true, drones: p.drones })
    }
    else if (taskID >= 90) {
        deleteTasks(drone)
        let { container = [0, 0, 0], coordinates = [0, 0, 0], kamikaze } = taskSett
        tasks.simpleTasks(drone, i.player, { simpleTaskID: taskID, container: `${container}`.replace(/,/g, " "), coordinates: `${coordinates}`.replace(/,/g, " "), kamikaze, backToMain: true })
    }
}

export function simpleDroneTasks(drone, player, p = {}) {
    const droneName = JSON.parse(drone.getTags().find(f => { return f.includes('{"dName":"') }) ?? '{"dName":""}').dName
    const { dLang } = JSON.parse(player.getTags().find(f => { return f.includes('{"dLang":') }) ?? '{"dLang":0}')

    const tasksOptions = new ActionFormData().title(`${kUI}§t§f${translation(dLang, "dTasks")}`).body(`§8 ${droneName}§‰`)
        .button(`§8< §h${translation(dLang, "cBatt")} §8>\n${!p.antenna ? `§c${translation(dLang, "lock")}` : ``}`, !p.antenna ? `textures/icons/locked_tasks` : `textures/icons/tasks_list`) //antenna only
        .button(`§8< §h${translation(dLang, "gTLoc")} §8>`, `textures/icons/tasks_list`)
        .button(`§8< §h${translation(dLang, "sInve")} §8>`, `textures/icons/tasks_list`)
        .button(`§8< §h${translation(dLang, "tIFCo")} §8>`, `textures/icons/tasks_list`)
        .button(`§8< §h${translation(dLang, "dInve")} §8>`, `textures/icons/tasks_list`) //not interrupt
        .button(`§8< §h${translation(dLang, "clTask")} §8>\n${!p.antenna ? `§c${translation(dLang, "lock")}` : ``}`, !p.antenna ? `textures/icons/locked_tasks` : `textures/icons/tasks_list`) //antenna only
        .button(`§8< §h${translation(dLang, "fMode")} §8>\n${!p.antenna ? `§c${translation(dLang, "lock")}` : ``}`, !p.antenna ? `textures/icons/locked_tasks` : `textures/icons/tasks_list`) //antenna only
        .button(`§8< §h${translation(dLang, "wMode")} §8>\n${!p.antenna ? `§c${translation(dLang, "lock")}` : ``}`, !p.antenna ? `textures/icons/locked_tasks` : `textures/icons/tasks_list`) //antenna only

    tasksOptions.show(player).then(r => {
        if (!r.canceled) {
            if (!p.antenna && (r.selection === 0 || r.selection === 5 || r.selection === 6 || r.selection === 7)) {
                simpleDroneTasks(drone, player, p)
                return
            }
            if (r.selection != 4) deleteTasks(drone, p)

            p.simpleTaskID = r.selection
            tasks.simpleTasks(drone, player, p)
        }
        else p.antenna ? antennaMenu({ entity: drone, player: player }, p) : droneMenu({ target: drone, player: player }, p)
    })
}

export function droneTasks(drone, player, p = {}) {
    const droneName = JSON.parse(drone.getTags().find(f => { return f.includes('{"dName":"') }) ?? '{"dName":""}').dName
    const { dLang } = JSON.parse(player.getTags().find(f => { return f.includes('{"dLang":') }) ?? '{"dLang":0}')

    const tasksOptions = new ActionFormData().title(`${kUI}§t§f${translation(dLang, "dTasks")}`).body(`§8 ${droneName}§‰`)
        .button(`§8< §h${translation(dLang, "mALoc")} §8>`, `textures/icons/tasks_list`)
        .button(`§8< §h${translation(dLang, "kllMb")} §8>`, `textures/icons/tasks_list`)
        .button(`§8< §h${translation(dLang, "fALoc")} §8>`, `textures/icons/tasks_list`)
        .button(`§8< §h${translation(dLang, "bMobs")} §8>`, `textures/icons/tasks_list`)
        .button(`§8< §h${translation(dLang, "mNBlo")} §8>`, `textures/icons/tasks_list`)
        .button(`§8< §h${translation(dLang, "cItem")} §8>`, `textures/icons/tasks_list`)
        .button(`§8< §h${translation(dLang, "oDect")} §8>${p.drones ? `\n§c${translation(dLang, "lwarn")}` : ``}`, `textures/icons/tasks_list`)
        .button(`§8< §h${translation(dLang, "mItem")} §8>`, `textures/icons/tasks_list`)
        .button(`§8< §h${translation(dLang, "remlq")} §8>`, `textures/icons/tasks_list`)
        .button(`§8< §h${translation(dLang, "clnStr")} §8>`, `textures/icons/tasks_list`)
        .button(`§8< §h${translation(dLang, "fishg")} §8>`, `textures/icons/tasks_list`)
        .button(`§8< §h${translation(dLang, "illArea")} §8>`, `textures/icons/tasks_list`)
        .button(`§8< §h${translation(dLang, "rCatt")} §8>\n §c${translation(dLang, "lock")}`, `textures/icons/locked_tasks`)
        .button(`§8< §h${translation(dLang, "sShee")} §8>\n §c${translation(dLang, "lock")}`, `textures/icons/locked_tasks`)
        .button(`§8< §h${translation(dLang, "mCows")} §8>\n §c${translation(dLang, "lock")}`, `textures/icons/locked_tasks`)

    tasksOptions.show(player).then(r => {
        if (!r.canceled) {
            deleteTasks(drone, p)

            if (r.selection === 0) {
                tasks.mineALocation(drone, player, p)
            }
            else if (r.selection === 1) {
                tasks.killMobs(drone, player, p)
            }
            else if (r.selection === 2) {
                tasks.fillLocation(drone, player, p)
            }
            else if (r.selection === 3) {
                tasks.bringMobs(drone, player, p)
            }
            else if (r.selection === 4) {
                tasks.mineNearbyBlocks(drone, player, p)
            }
            else if (r.selection === 5) {
                tasks.collectItems(drone, player, p)
            }
            else if (r.selection === 6) {
                tasks.oreDetector(drone, player, p)
            }
            else if (r.selection === 7) {
                tasks.moveItems(drone, player, p)
            }
            else if (r.selection === 8) {
                tasks.removeLiquids(drone, player, p)
            }
            else if (r.selection === 9) {
                tasks.cloneStructure(drone, player, p)
            }
            else if (r.selection === 10) {
                tasks.fishing(drone, player, p)
            }
            else if (r.selection === 11) {
                tasks.illuminateArea(drone, player, p)
            }
            else droneTasks(drone, player, p)
        }
        else p.antenna ? antennaMenu({ entity: drone, player: player }, p) : droneMenu({ target: drone, player: player }, p)
    })
}

const initSystem = () => system.runTimeout(() => {
    droneStatusChecks(); tasks.selectInfo()
    initSystem()
}, 40)
initSystem()

function batteryUsage(drone, setts, add) {
    const data = drone.getTags()
    const battery = data.find(f => { return f.includes('{"battery":') }) ?? '{"battery":100}'
    const battVal = JSON.parse(battery).battery
    const { dName, show } = JSON.parse(data.find(f => { return f.includes('{"dName":') }) ?? `{}`)
    const { sttC, sttE } = setts

    if (add && battVal < 100) {
        drone.removeTag(battery)

        let batteryVal = Math.min(battVal + (battVal == 0 ? 0.5 : 0.1), 100).toFixed(1)
        if (batteryVal == 100.0) batteryVal = 100
        drone.addTag(`{"battery":${batteryVal}}`)

        if (show != 0 && sttE) {
            const { owner } = JSON.parse(data.find(f => { return f.includes('{"owner":') }) ?? `{}`)
            const { dLang } = JSON.parse(data.find(f => { return f.includes('{"dLang":') }) ?? '{"dLang":0}')
            let nameData = dName + (sttC ? `\n§7${translation(dLang, "owner")}: ${owner}` : ``) + (sttE ? `\n${batteryVal < 10 ? `§c` : `§a`}${translation(dLang, "batt")}: ${batteryVal}%` : ``)
            drone.nameTag = `§f§d§r§0§n§e§f${nameData}`
        }
    }
    if (!add) {
        if (battVal > 0) {
            drone.removeTag(battery)

            const batteryVal = (battVal - 0.1).toFixed(1)
            drone.addTag(`{"battery":${batteryVal}}`)
            if (battVal - 0.1 === 0) drone.triggerEvent("offMode")

            if (show != 0 && sttE) {
                const { owner } = JSON.parse(data.find(f => { return f.includes('{"owner":') }) ?? `{}`)
                const { dLang } = JSON.parse(data.find(f => { return f.includes('{"dLang":') }) ?? '{"dLang":0}')

                let nameData = dName + (sttC ? `\n§7${translation(dLang, "owner")}: ${owner}` : ``) + (sttE ? `\n${batteryVal < 10 ? `§c` : `§b`}${translation(dLang, "batt")}: ${batteryVal}%` : ``)
                drone.nameTag = `§f§d§r§0§n§e§f${nameData}`
            }
        }
        else drone.triggerEvent("offMode")
    }
}

function droneStatusChecks() {
    const players = world.getAllPlayers()
    let taskMine = []
    let taskFill = []
    let taskRLiq = []

    for (const dimension of group(players.map(f => f.dimension.id))) {
        for (const bot of world.getDimension(dimension).getEntities({ families: ["BOT-Entity"] })) {
            const state = bot.getComponent('minecraft:variant').value
            const data = bot.getTags()
            const { battery } = JSON.parse(data.find(f => { return f.includes('{"battery":') }) ?? '{"battery":100}')
            const { taskID, harvest, from, to, chest, grow, reload } = JSON.parse(data.find(f => { return f.includes('{"task":"') }) ?? '{"taskID":0}')
            const velocity = bot.getVelocity()

            const tagSwarm = data.find(f => { return f.includes('{"swarmID":') }) ?? `{}`
            const { swarmID, playerID } = JSON.parse(tagSwarm)
            if (swarmID) {
                for (const player of players) {
                    if (player.id === playerID && !player.getTags().some(f => { return f.includes(`","swarmID":"${swarmID}"`) })) {
                        bot.removeTag(tagSwarm)
                    }
                }
            }
            if (!bot.hasTag("initSystem")) {
                const { ticks } = JSON.parse(data.find(f => { return f.includes('{"scanRadius":') }) ?? '{}')
                bot.getComponent('minecraft:skin_id').value = 0
                bot.addTag("initSystem")
                bot.dimension.playSound("drone.bot_4", bot.location, { volume: 0.4 })

                if (taskID && taskID < 90 && bot.typeId === "drone:antenna") executeTasks(bot, 100, { firstCall: true }, ticks ?? 20)
                else if (taskID === 1) {
                    const { bFilter } = JSON.parse(data.find(f => { return f.includes('{"bFilter":[') }) ?? '{"bFilter":[]}')
                    taskMine.push(JSON.stringify({ from, to, chest, harvest, reload, bFilter, dimension: bot.dimension.id }))
                }
                else if (taskID === 3) {
                    taskFill.push(JSON.stringify({ from, to, chest, grow, reload, dimension: bot.dimension.id }))
                }
                else if (taskID === 9) {
                    taskRLiq.push(JSON.stringify({ from, to, reload, dimension: bot.dimension.id }))
                }
                else if (taskID >= 90) executeTasks(bot, taskID, { firstCall: true }, ticks ?? 20)
                else if (taskID > 1) executeTasks(bot, taskID, { firstCall: true })
                else {
                    const { followPlayer, swarm } = JSON.parse(data.find(f => { return f.includes('{"followPlayer":t') }) ?? '{"followPlayer":false}')
                    if (followPlayer) moveSystem(bot, { location: bot.location, followPlayer: true, radius: swarm ? 12 : 4 })
                }
            }
            else if (state === 0 && bot.typeId === "effect99:drone") {
                const { x, y, z } = bot.location
                try {
                    const block = bot.dimension.getBlock({ x, y, z })
                    if (block && velocity.x + velocity.y + velocity.z === 0 && (((!block.below().isAir && !block.below().isLiquid && block.above().isAir) || ((!block.isAir && !block.isLiquid) || block.typeId === "minecraft:farmland")))) bot.teleport({ x, y: y + 1, z })
                }
                catch (e) { }
            }
            if (bot.typeId === "effect99:drone") {
                const { sttC, sttE, sttH } = JSON.parse(data.find(f => { return f.includes('{"sttA":') }) ?? `{}`)
                if (taskID != 0 || (velocity.x + velocity.y + velocity.z >= 0.1)) {
                    batteryUsage(bot, { sttC, sttE })
                }
                if (state === 0 && battery < 10) bot.triggerEvent("walkMode")
                if (state === 2 && battery > 0) {
                    bot.triggerEvent("walkMode")
                    bot.triggerEvent("default")
                    bot.removeTag(`initSystem`)
                }
                if (state != 2 && battery <= 0) {
                    bot.triggerEvent("offMode")
                    bot.dimension.playSound("drone.shutdown", bot.location)
                }
                if (sttH && battery >= 10) {
                    bot.triggerEvent("flyMode")
                }
                if (battery >= 5) {
                    switch (Math.floor(Math.random() * 500)) {
                        case 0:
                            if (state) break
                            bot.playAnimation("animation.drone.random_d")
                            bot.dimension.playSound("drone.bot", bot.location)
                            break
                        case 1:
                            bot.playAnimation("animation.drone.random_c")
                            bot.dimension.playSound("drone.bot_3", bot.location)
                            break
                        case 2:
                            bot.playAnimation("animation.drone.random_e")
                            bot.dimension.playSound("drone.bot_6", bot.location)
                            break
                        case 3:
                            if (state) break
                            bot.playAnimation("animation.drone.random_b")
                            bot.dimension.playSound("drone.bot_7", bot.location)
                            break
                        case 4:
                            bot.playAnimation("animation.drone.random_a")
                            bot.dimension.playSound("drone.bot_5", bot.location)
                            break
                    }
                }
                if (battery < 100 && bot.hasComponent("is_sheared") && Math.random() < 0.6) {
                    system.runTimeout(() => { batteryUsage(bot, { sttC, sttE }, true) }, 5)
                }
                const currentName = bot.nameTag
                if (!currentName.includes("§f§d§r§0§n§e§f")) bot.nameTag = "§f§d§r§0§n§e§f" + currentName
            }
        }
    }
    if (taskMine[0]) {
        for (const fromTo of group(taskMine)) {
            const blocks = []
            const dimension = world.getDimension(JSON.parse(fromTo).dimension)
            const { from, to, harvest, reload, bFilter, chest } = JSON.parse(fromTo)
            const [fx, fy, fz] = from ?? []
            const [tx, ty, tz] = to ?? []
            if (fz === undefined || tz === undefined) continue
            bFilter.forEach((f, i) => { if (!f.includes(":")) bFilter[i] = "minecraft:" + f })

            for (let x = Math.min(fx, tx); x <= Math.max(fx, tx); x++) {
                for (let y = Math.min(fy, ty); y <= Math.max(fy, ty); y++) {
                    for (let z = Math.min(fz, tz); z <= Math.max(fz, tz); z++) {
                        const block = dimension.getBlock({ x, y, z })
                        if (block && (block.isAir || block.isLiquid || unbreakableBlocks.includes(block.typeId) || (harvest && !harvestable.some(({ block: b, level: l, state }) => { return b === block.typeId && block.permutation.getState(state) === l }))
                            || (bFilter.length && !bFilter.includes(block.typeId)))) continue
                        blocks.push({ x, y, z })
                    }
                }
            }
            for (const drone of dimension.getEntities({ type: "effect99:drone" })) {
                const setts = drone.getTags().find(f => { return f.includes('{"task":"') })
                if (setts === JSON.stringify({ task: `mALoc`, taskID: 1, from, to, harvest, reload, chest })) {
                    executeTasks(drone, 1, { firstCall: true, blocksList: blocks })
                }
            }
        }
        taskMine = []
    }
    if (taskFill[0]) {
        for (const fromTo of group(taskFill)) {
            const blocks = []
            const dimension = world.getDimension(JSON.parse(fromTo).dimension)
            const { from, to, chest, grow, reload } = JSON.parse(fromTo)
            const [fx, fy, fz] = from
            const [tx, ty, tz] = to
            if (fx === undefined || tx === undefined) continue

            for (let y = Math.min(fy, ty); y <= Math.max(fy, ty); y++) {
                for (let x = Math.min(fx, tx); x <= Math.max(fx, tx); x++) {
                    for (let z = Math.min(fz, tz); z <= Math.max(fz, tz); z++) {
                        const block = dimension.getBlock({ x, y, z })
                        if (!block || (!grow && !block.isAir && !block.isLiquid) || (grow && block.below().typeId != "minecraft:farmland")) continue
                        blocks.push({ x, y, z })
                    }
                }
            }
            for (const drone of dimension.getEntities({ type: "effect99:drone" })) {
                const setts = drone.getTags().find(f => { return f.includes('{"task":"') })
                if (setts === JSON.stringify({ task: `fALoc`, taskID: 3, grow, reload, from, to, chest })) {
                    executeTasks(drone, 3, { firstCall: true, blocksList: blocks })
                }
            }
        }
        taskFill = []
    }
    if (taskRLiq[0]) {
        for (const fromTo of group(taskRLiq)) {
            const blocks = []
            const dimension = world.getDimension(JSON.parse(fromTo).dimension)
            const { from, to, reload } = JSON.parse(fromTo)
            const [fx, fy, fz] = from
            const [tx, ty, tz] = to
            if (fx === undefined || tx === undefined) continue

            for (let x = Math.min(fx, tx); x <= Math.max(fx, tx); x++) {
                for (let y = Math.min(fy, ty); y <= Math.max(fy, ty); y++) {
                    for (let z = Math.min(fz, tz); z <= Math.max(fz, tz); z++) {
                        const block = dimension.getBlock({ x, y, z })
                        if (!block || block.isAir || !block.isLiquid || block.permutation.getState("liquid_depth") != 0) continue
                        blocks.push({ x, y, z })
                    }
                }
            }
            for (const drone of dimension.getEntities({ type: "effect99:drone" })) {
                const setts = drone.getTags().find(f => { return f.includes('{"task":"') })
                if (setts === JSON.stringify({ task: `remlq`, taskID: 9, from, to, reload })) {
                    executeTasks(drone, 9, { firstCall: true, blocksList: blocks })
                }
            }
        }
        taskRLiq = []
    }
}

function destroyed(bot) {
    try {
        const { x, y, z } = bot.location

        bot.clearVelocity()
        bot.playAnimation("animation.drone.destroyed")
        bot.dimension.playSound("random.explode", bot.location, { pitch: 1.2 })

        bot.dimension.spawnParticle("minecraft:large_explosion", { x: x + 0.5, y: y + 0.8, z })
        bot.dimension.spawnParticle("minecraft:large_explosion", { x: x - 0.5, y: y + 0.5, z })
        bot.dimension.spawnParticle("minecraft:large_explosion", { x, y: y + 0.3, z: z + 0.5 })
        bot.dimension.spawnParticle("minecraft:large_explosion", { x, y: y + 0.6, z: z - 0.5 })

        bot.dimension.spawnItem(new ItemStack("minecraft:iron_ingot", 1), { x, y, z })
        bot.dimension.spawnItem(new ItemStack("minecraft:iron_ingot", 1), { x, y: y + 0.2, z: z - 0.2 })
        bot.dimension.spawnItem(new ItemStack("minecraft:iron_ingot", 1), { x: x + 0.2, y: y - 0.2, z })
        bot.dimension.spawnItem(new ItemStack("minecraft:redstone", 1), { x, y: y + 0.3, z })
    }
    catch (e) { }
    bot.addTag("destroyed")
    bot.remove()
}

system.runTimeout(() => {
    const players = world.getAllPlayers()
    for (const dimension of group(players.map(f => f.dimension.id))) {
        for (const drone of world.getDimension(dimension).getEntities({ tags: ["initSystem"] })) {
            drone.removeTag("initSystem")
        }
    }
    for (const player of players) {
        player.camera.clear()
    }
})


function group(arr) {
    const groups = new Map()
    arr.forEach(str => {
        if (!groups.has(str)) {
            groups.set(str, [])
        }
        groups.get(str).push(str)
    })
    return Array.from(groups.keys())
}

function sRGB(r, g, b, n = true) {
    if (n) return {
        r: Math.min(1.0, parseFloat((r / 255).toFixed(3))),
        g: Math.min(1.0, parseFloat((g / 255).toFixed(3))),
        b: Math.min(1.0, parseFloat((b / 255).toFixed(3)))
    }
    else return [
        Math.min(255, Math.round(r * 255)),
        Math.min(255, Math.round(g * 255)),
        Math.min(255, Math.round(b * 255))
    ]
}
const defaultColors = [
    { r: 0.0, g: 0.0, b: 0.0 },
    { r: 1.0, g: 1.0, b: 1.0 },
    { r: 1.0, g: 0.0, b: 0.0 },
    { r: 0.0, g: 0.0, b: 1.0 },
    { r: 1.0, g: 1.0, b: 0.0 },
    { r: 0.0, g: 1.0, b: 0.0 },
    { r: 0.5, g: 0.0, b: 0.5 },
    { r: 1.0, g: 0.5, b: 0.0 },
    { r: 1.0, g: 0.2, b: 0.6 },
    { r: 0, g: 0.898, b: 0.882 }
]