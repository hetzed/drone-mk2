import { world, system, ItemStack, MolangVariableMap, BlockPermutation } from "@minecraft/server"
import { moveSystem } from "./moveSystem"
import { translation } from "./translation"

export const executeTasks = (drone, task, p = {}, runTime = 8) => system.runTimeout(() => {
    if (!drone || !drone.isValid) return
    if ((!p.firstCall && drone.hasTag("RuntimeOut")) || (drone.hasTag("DCA") && task < 90) || p.break) return
    const { taskUniqueID } = JSON.parse(drone.getTags().find(f => { return f.includes('{"taskUniqueID":"') }) ?? '{}')

    const dimension = drone.dimension
    if (!p.firstCall) {
        if (taskUniqueID != p.uniqueID) return
        else if (task === 1) {
            const { from, to, harvest, reload, chest: [cx, cy, cz] } = JSON.parse(drone.getTags().find(f => { return f.includes('{"task":"') }) ?? '{"chest":[]}')
            const [fx, fy, fz] = from ?? []
            const [tx, ty, tz] = to ?? []
            if (fz === undefined || tz === undefined) return

            const blockFilter = JSON.parse(drone.getTags().find(f => { return f.includes('{"bFilter":[') }) ?? '{"bFilter":[]}').bFilter
            blockFilter.forEach((f, i) => { if (!f.includes(":")) blockFilter[i] = "minecraft:" + f })

            if (cz) {
                drone.triggerEvent("itemHopper")
                const inventory = drone.getComponent("inventory").container
                const fullInv = !inventory.emptySlotsCount
                if (fullInv) { moveSystem(drone, { location: { x: cx, y: cy, z: cz }, taskId: task, uniqueID: taskUniqueID, blocksList: p.blocksList, saveInv: true, timer: 0 }); return }
                for (const item of dimension.getEntities({ location: drone.location, maxDistance: 3, type: "item" })) item.teleport(drone.location)
            }
            if (!p.blocksList || (reload && p.blocksList && !p.blocksList[0])) {
                const blocks = []
                for (let x = Math.min(fx, tx); x <= Math.max(fx, tx); x++) {
                    for (let y = Math.min(fy, ty); y <= Math.max(fy, ty); y++) {
                        for (let z = Math.min(fz, tz); z <= Math.max(fz, tz); z++) {
                            const block = dimension.getBlock({ x, y, z })
                            if (!block || block.isAir || block.isLiquid || unbreakableBlocks.includes(block.typeId) || (harvest && !harvestable.some(({ block: b, level: l, state }) => { return b === block.typeId && block.permutation.getState(state) === l }))
                                || (blockFilter[0] && !blockFilter.includes(block.typeId))) continue
                            blocks.push({ x, y, z })
                        }
                    }
                }
                p.blocksList = blocks
            }
            else {
                const { x, y, z } = drone.location
                const blocks = []

                for (let i = -2; i <= 2; i++) {
                    for (let j = -2; j <= 2; j++) {
                        for (let k = -2; k <= 2; k++) {
                            const coords = { x: Math.floor(x) + i, y: Math.floor(y) + j, z: Math.floor(z) + k }
                            const block = dimension.getBlock(coords)

                            if (!block || block.isAir || block.isLiquid || unbreakableBlocks.includes(block.typeId) || !isCoordinateInsideRect(coords, { x: fx, y: fy, z: fz }, { x: tx, y: ty, z: tz })
                                || (harvest && !harvestable.some(({ block: b, level: l, state }) => { return b === block.typeId && block.permutation.getState(state) === l }))
                                || (blockFilter[0] && !blockFilter.includes(block.typeId))) continue
                            blocks.push(block.location)

                        }
                    }
                }
                if (!blocks[0]) p.blocksList = p.blocksList.sort(() => Math.random() - 0.5)

                let closestBlock = harvest ? undefined : p.blocksList[0]
                let closestDistance = Infinity
                let i = 0

                for (const blockLocation of blocks[0] ? blocks : p.blocksList) {
                    const { x, y, z } = blockLocation
                    const block = dimension.getBlock({ x, y, z })
                    if (!block) { i++; continue }

                    if (!blocks[0] && (block.isAir || block.isLiquid
                        || (harvest && !harvestable.some(({ block: b, level: l, state }) => { return b === block.typeId && block.permutation.getState(state) === l }))
                        || (blockFilter[0] && !blockFilter.includes(block.typeId)))) { p.blocksList.splice(i, 1); i++; continue }

                    if (!blocks[0]) {
                        closestBlock = blockLocation
                        break
                    }
                    const distance = calculateDistance(drone.location, blockLocation)
                    if (distance < closestDistance) {
                        closestDistance = distance
                        closestBlock = blockLocation
                    }
                    i++
                }
                if (!closestBlock && !reload && !p.blocksList[0]) {
                    if (!cz || p.finish) { deleteTasks(drone, undefined, true); return }
                    else { moveSystem(drone, { location: { x: cx, y: cy, z: cz }, taskId: task, uniqueID: taskUniqueID, blocksList: [], saveInv: true, timer: 0 }); return }
                }
                else if (!reload || closestBlock) {
                    moveSystem(drone, { location: closestBlock, reloadTask: true, taskId: task, uniqueID: taskUniqueID, blocksList: p.blocksList, breakBlock: true, timer: blocks[0] ? 0 : 40, })
                    return
                }
                runTime = (harvest && !p.blocksList[0]) ? 100 : 8
            }
        }
        else if (task === 2) {
            const { radiusCenter, radius, animals, monsters, aquaticMobs, flyMobs, avoidCreepers, ignorePets, followPlayer, playerID } = JSON.parse(drone.getTags().find(f => { return f.includes('{"task":"') }) ?? '{}')
            let [dx, dy, dz] = radiusCenter

            if (followPlayer) {
                for (const player of dimension.getPlayers()) {
                    if (player.id === playerID) {
                        p.entity = player
                        let { x, y, z } = player.location
                        dx = Math.floor(x), dy = Math.floor(y), dz = Math.floor(z)
                    }
                }
                if (!p.entity) {
                    let { x, y, z } = drone.location
                    dx = Math.floor(x), dy = Math.floor(y), dz = Math.floor(z)
                }
            }
            const { mFilter } = JSON.parse(drone.getTags().find(f => { return f.includes('{"mFilter":[') }) ?? '{"mFilter":[]}')
            mFilter.forEach((f, i) => { if (!f.includes(":")) mFilter[i] = "minecraft:" + f })

            let location;
            let max = 0
            const { id } = JSON.parse(drone.getTags().find(f => { return f.includes('{"owner":') }) ?? `{"id":"0"}`)
            for (const entity of drone.dimension.getEntities({ location: { x: dx, y: dy, z: dz }, maxDistance: radius, excludeTypes: excludeEntities, excludeFamilies: ["inanimate"] })) {
                if (max >= 10) break
                if ((ignorePets && entity.hasComponent("is_tamed")) || (avoidCreepers && "minecraft:creeper" === entity.typeId) || id === entity.id) continue

                if ((animals && animalsList.includes(entity.typeId)) ||
                    (monsters && entity.hasComponent("type_family") && entity.getComponent("type_family").hasTypeFamily("monster")) ||
                    (aquaticMobs && aquaticMobsList.includes(entity.typeId)) ||
                    (flyMobs && (entity.hasComponent("can_fly") || flyMobsList.includes(entity.typeId))) ||
                    (mFilter[0] && mFilter.includes(entity.typeId))) {

                    const { x, y, z } = entity.location

                    let spawn = true
                    for (const { } of drone.dimension.getEntities({ location: { x, y, z }, maxDistance: 3, type: 'drone:target' })) {
                        spawn = false
                        break
                    }
                    if (!location) location = entity.location
                    if (spawn) {
                        try { drone.dimension.spawnEntity("drone:target", { x, y, z }) } catch (e) { }
                        max++
                    }
                }
            }

            const rad1 = Math.floor(Math.random() * 2) ? Math.floor(Math.random() * radius) : Math.floor(Math.random() * -radius)
            const rad2 = Math.floor(Math.random() * 2) ? Math.floor(Math.random() * radius) : Math.floor(Math.random() * -radius)
            const { x, y, z } = location ?? { x: dx + rad1, y: dy + Math.floor(Math.random() * 2 + 1), z: dz + rad2 }

            monsters ? drone.triggerEvent("attack_monsters") : drone.triggerEvent("attack_target")
            let data = { taskId: task, uniqueID: taskUniqueID, location: { x, y, z }, followEntity: followPlayer, entity: p.entity, updatePos: !location, gonna: followPlayer, reloadTask: true, radius: 6, timer: 0 }
            if (location) {
                const num1 = Math.floor(Math.random() * 2) ? 5 : -5
                const num2 = Math.floor(Math.random() * 2) ? 5 : -5
                data.location = { x: x + Math.floor(Math.random() * num1), y: y + Math.floor(Math.random() * 2 + 1), z: z + Math.floor(Math.random() * num2) }
            }
            if (followPlayer) data.radius = radius
            moveSystem(drone, data)
            return
        }
        else if (task === 3) {
            const { from, to, chest, grow, reload } = JSON.parse(drone.getTags().find(f => { return f.includes('{"task":"') }) ?? '{}')
            const [cx, cy, cz] = chest
            const [fx, fy, fz] = from
            const [tx, ty, tz] = to
            if (fz === undefined || tz === undefined || cz === undefined) return

            const inventory = drone.getComponent("inventory").container
            p.emptyInv = inventory.size === inventory.emptySlotsCount

            if (!p.blocksList || (reload && p.blocksList && !p.blocksList[0])) {
                const blocks = []
                for (let y = Math.min(fy, ty); y <= Math.max(fy, ty); y++) {
                    for (let x = Math.min(fx, tx); x <= Math.max(fx, tx); x++) {
                        for (let z = Math.min(fz, tz); z <= Math.max(fz, tz); z++) {
                            const block = drone.dimension.getBlock({ x, y, z })
                            if (!block || (!grow && !block.isAir && !block.isLiquid) || (grow && block.below().typeId != "minecraft:farmland")) continue
                            blocks.push({ x, y, z })
                        }
                    }
                }
                p.blocksList = blocks
            }
            else {
                let validBlock
                let i = 0

                if (p.blocksList[0]) {
                    let minY = p.blocksList[0].y
                    let searchCosest = true

                    for (let i = 0; i < inventory.size; i++) {
                        const item = inventory.getItem(i)
                        if (!item) continue
                        if (item.typeId.includes("_bucket")) searchCosest = false
                    }
                    if (searchCosest) {
                        const blocks = []
                        const { x, y, z } = drone.location

                        for (let j = -2; j <= 0; j++) {
                            if (Math.floor(y) + j != minY) continue
                            for (let i = -2; i <= 2; i++) {
                                for (let k = -2; k <= 2; k++) {
                                    const coords = { x: Math.floor(x) + i, y: minY, z: Math.floor(z) + k }
                                    const block = dimension.getBlock(coords)
                                    if (!block || (!grow && !block.isAir && !block.isLiquid) || !isCoordinateInsideRect(coords, { x: fx, y: fy, z: fz }, { x: tx, y: ty, z: tz }) ||
                                        (grow && (!block.isAir || block.below().typeId != "minecraft:farmland"))) continue

                                    blocks.push(coords)
                                }
                            }
                        }
                        let closestDistance = Infinity
                        for (const blockLocation of blocks) {
                            const distance = calculateDistance(drone.location, blockLocation)
                            if (distance < closestDistance) {
                                closestDistance = distance
                                validBlock = blockLocation
                            }
                        }
                    }
                    if (!validBlock) p.blocksList.sort((a, b) => (a.y === minY && b.y === minY) ? Math.random() - 0.5 : 0)
                }
                if (!validBlock) {
                    for (const location of p.blocksList) {
                        const block = drone.dimension.getBlock(location)
                        if (!block || (!block.isAir && !block.isLiquid) || (grow && block.below().typeId != "minecraft:farmland")) { p.blocksList.splice(i, 1); i++; continue }
                        validBlock = location
                        break
                    }
                }
                if (p.emptyInv && p.blocksList[0]) { moveSystem(drone, { location: { x: cx, y: cy, z: cz }, taskId: task, uniqueID: taskUniqueID, blocksList: p.blocksList, takeChestItem: true, timer: 0, }); return }
                if (!validBlock && !reload) {
                    if (p.finish) { deleteTasks(drone, undefined, true); return }
                    else { moveSystem(drone, { location: { x: cx, y: cy, z: cz }, taskId: task, uniqueID: taskUniqueID, blocksList: [], saveInv: true, timer: 0, }); return }
                }
                if (!reload || validBlock) { moveSystem(drone, { location: validBlock, taskId: task, uniqueID: taskUniqueID, blocksList: p.blocksList, grow, placeBlock: true, timer: 0, }); return }
                runTime = (grow && !p.blocksList[0]) ? 100 : 8
            }
        }
        else if (task === 4) {
            const { coords, rad, minRad, animals, monsters, aquaticMobs, flyMobs } = JSON.parse(drone.getTags().find(f => { return f.includes('{"task":"') }) ?? '{}')
            let [dx, dy, dz] = coords
            if (dz === undefined) return
            dy += 1

            if (p.entity && p.entity.isValid && (p.leaveMob || drone.getComponent('minecraft:skin_id').value === 2)) {
                moveSystem(drone, { taskId: task, uniqueID: taskUniqueID, location: { x: dx, y: dy, z: dz }, entity: p.entity, leaveMob: true, timer: 0 })
                return
            }
            else {
                const { mFilter } = JSON.parse(drone.getTags().find(f => { return f.includes('{"mFilter":[') }) ?? '{"mFilter":[]}')
                mFilter.forEach((f, i) => { if (!f.includes(":")) mFilter[i] = "minecraft:" + f })

                let entity;
                for (const mob of drone.dimension.getEntities({ location: { x: dx, y: dy, z: dz }, maxDistance: rad, minDistance: minRad, excludeTypes: excludeEntities, excludeFamilies: ["inanimate"] }).sort(() => Math.random() - 0.5)) {
                    if ((animals && animalsList.includes(mob.typeId)) ||
                        (monsters && mob.hasComponent("type_family") && mob.getComponent("type_family").hasTypeFamily("monster")) ||
                        (aquaticMobs && aquaticMobsList.includes(mob.typeId)) ||
                        (flyMobs && (mob.hasComponent("can_fly") || flyMobsList.includes(mob.typeId))) ||
                        (mFilter[0] && mFilter.includes(mob.typeId))) {
                        if (mob.id === p.skipID) continue
                        if (!entity) entity = mob
                        mob.addTag("target")
                        break
                    }
                }
                const rad1 = Math.floor(Math.random() * 2) ? Math.max(Math.floor(Math.random() * rad), minRad) : Math.min(Math.floor(Math.random() * -rad), -minRad)
                const rad2 = Math.floor(Math.random() * 2) ? Math.max(Math.floor(Math.random() * rad), minRad) : Math.min(Math.floor(Math.random() * -rad), -minRad)
                const { x, y, z } = entity ? entity.location : { x: dx + rad1, y: dy + Math.floor(Math.random() * 4 + 1), z: dz + rad2 }

                moveSystem(drone, { taskId: task, uniqueID: taskUniqueID, location: { x, y, z }, pickUp: true, updatePos: true, timer: 0, entity })
                return
            }
        }
        else if (task === 5) {
            const { hScanRadius: h, vScanRadius: v, followPlayer, playerID } = JSON.parse(drone.getTags().find(f => { return f.includes('{"task":"') }) ?? '{}')
            if (followPlayer) for (const player of dimension.getPlayers()) if (player.id === playerID) p.entity = player

            const { bFilter } = JSON.parse(drone.getTags().find(f => { return f.includes('{"bFilter":[') }) ?? '{"bFilter":[]}')
            bFilter.forEach((f, i) => { if (!f.includes(":")) bFilter[i] = "minecraft:" + f })
            drone.triggerEvent("itemHopper")

            for (const item of dimension.getEntities({ location: drone.location, maxDistance: 2, type: "item" })) item.teleport(drone.location)
            const { x, y, z } = drone.location
            const blocks = []

            for (let i = -h; i <= h; i++) {
                for (let j = -v; j <= v; j++) {
                    for (let k = -h; k <= h; k++) {
                        try {
                            const block = dimension.getBlock({ x: Math.floor(x) + i, y: Math.floor(y) + j, z: Math.floor(z) + k })
                            if (!block || block.isAir || block.isLiquid || unbreakableBlocks.includes(block.typeId) || (bFilter[0] && !bFilter.includes(block.typeId))) continue
                            blocks.push(block.location)
                        }
                        catch (e) { }
                    }
                }
            }
            let closestBlock = blocks[0]
            let closestDistance = Infinity
            let radius = followPlayer ? Math.max(6, h) : 15

            for (const blockLocation of blocks) {
                const { x, y, z } = blockLocation
                const block = dimension.getBlock({ x, y, z })
                if (!block) continue
                if (block.isAir || block.isLiquid || (bFilter[0] && !bFilter.includes(block.typeId))) continue

                const distance = calculateDistance(drone.location, blockLocation)
                if (distance < closestDistance) {
                    closestDistance = distance
                    closestBlock = blockLocation
                }
            }
            if (closestBlock) {
                let data = { location: closestBlock, taskId: task, uniqueID: taskUniqueID, followEntity: followPlayer, entity: p.entity, updatePos: false, breakBlock: true, timer: 30 }
                if (followPlayer) data.radius = radius
                moveSystem(drone, data)
                return
            }
            else {
                const { x: dx, y: dy, z: dz } = drone.location
                const radX = Math.floor(Math.random() * 2) ? Math.floor(Math.random() * radius) : Math.floor(Math.random() * -radius)
                const radY = Math.floor(Math.random() * 2) && drone.location.y < 65 ? Math.floor(Math.random() * radius) : Math.floor(Math.random() * -radius)
                const radZ = Math.floor(Math.random() * 2) ? Math.floor(Math.random() * radius) : Math.floor(Math.random() * -radius)
                const { x, y, z } = { x: dx + radX, y: dy + radY, z: dz + radZ }

                let data = { location: { x, y, z }, gonna: true, taskId: task, uniqueID: taskUniqueID, followEntity: followPlayer, entity: p.entity, updatePos: true, timer: 40 }
                if (followPlayer) data.radius = radius
                moveSystem(drone, data)
                return
            }
        }
        else if (task === 6) {
            const { center, chest, radius, followPlayer, playerID } = JSON.parse(drone.getTags().find(f => { return f.includes('{"task":"') }) ?? '{}')
            let [dx, dy, dz] = center
            const [cx, cy, cz] = chest

            const inventory = drone.getComponent("inventory").container
            if (followPlayer) {
                let { x, y, z } = drone.location
                dx = Math.floor(x), dy = Math.floor(y), dz = Math.floor(z)
                for (const player of dimension.getPlayers()) { if (player.id === playerID) p.entity = player }
            }
            else if (cz && !inventory.emptySlotsCount) {
                moveSystem(drone, { location: { x: cx, y: cy, z: cz }, taskId: task, uniqueID: taskUniqueID, saveInv: true, timer: 0 })
                return
            }
            const { iFilter } = JSON.parse(drone.getTags().find(f => { return f.includes('{"iFilter":[') }) ?? '{"iFilter":[]}')
            iFilter.forEach((f, i) => { if (!f.includes(":")) iFilter[i] = "minecraft:" + f })

            let location;
            if (inventory.emptySlotsCount) {
                for (const entity of drone.dimension.getEntities({ location: { x: dx, y: dy, z: dz }, maxDistance: radius, type: "item" })) {
                    let item = entity.getComponent("item").itemStack
                    if (entity.isOnGround && (!iFilter[0] || iFilter.includes(item.typeId))) {
                        location = entity.location
                        break
                    }
                }
            }
            const rad1 = Math.floor(Math.random() * 2) ? Math.floor(Math.random() * radius) : Math.floor(Math.random() * -radius)
            const rad2 = Math.floor(Math.random() * 2) ? Math.floor(Math.random() * radius) : Math.floor(Math.random() * -radius)
            const { x, y, z } = location ?? { x: dx + rad1, y: dy, z: dz + rad2 }

            let data = { taskId: task, uniqueID: taskUniqueID, location: { x, y, z }, followEntity: followPlayer, iFilter, entity: p.entity, updatePos: !location, collectItem: !!location, gonna: !location, timer: 0 }
            if (followPlayer) data.radius = radius
            moveSystem(drone, data)
            return
        }
        else if (task === 7) {
            const { ore, customOre, hScanRadius: h, vScanRadius: v, sound, playerID } = JSON.parse(drone.getTags().find(f => { return f.includes('{"task":"') }) ?? '{}')
            for (const player of dimension.getPlayers()) { if (player.id === playerID) p.entity = player }

            let { x, y, z } = drone.location
            p.distance = 9
            if (p.block && p.block.isValid) {
                if ((customOre && customOre === p.block.typeId) || (!customOre && ores.some(({ typeId, id }) => { return (id == ore && typeId === p.block.typeId) }))) {
                    const { x: bx, y: by, z: bz } = p.block.location
                    const distance = Math.floor(Math.sqrt(((x - 0.5) - bx) ** 2 + ((y - 0.5) - by) ** 2 + ((z - 0.5) - bz) ** 2))
                    if (distance < 9) {
                        p.distance = distance - 2
                    }
                    else p.block = undefined
                }
                else p.block = undefined
            }
            if (p.distance > 8) {
                for (let i = -h; i <= h; i++) {
                    for (let j = -v; j <= v; j++) {
                        for (let k = -h; k <= h; k++) {
                            try {
                                const block = dimension.getBlock({ x: Math.floor(x) + i, y: Math.floor(y) + j, z: Math.floor(z) + k })
                                if (block && ((customOre && customOre === block.typeId) || (!customOre && ores.some(({ typeId, id }) => { return (id == ore && typeId === block.typeId) })))) {
                                    const { x: bx, y: by, z: bz } = block.location
                                    const distance = Math.floor(Math.sqrt(((x - 0.5) - bx) ** 2 + ((y - 0.5) - by) ** 2 + ((z - 0.5) - bz) ** 2))
                                    if (distance < p.distance + 2) {
                                        p.distance = distance - 2
                                        p.block = block
                                    }
                                }
                            }
                            catch (e) { }
                        }
                    }
                }
            }
            const speedSound = (i = 0) => system.runTimeout(() => {
                drone.dimension.playSound(sounds[sound].sound, drone.location, { volume: sounds[sound].volume, pitch: sounds[sound].pitch })
                if (i < 5) speedSound(i + 1)
            }, 2)

            if (p.distance < 9 && system.currentTick % Math.max(1, p.distance) === 0) {
                let molang = new MolangVariableMap()

                molang.setSpeedAndDirection(`direction`, 2, { x: p.block.location.x + 0.5 - x, y: p.block.location.y - y, z: p.block.location.z + 0.5 - z })
                drone.dimension.spawnParticle(`drone_emitter`, { x, y: y + 0.5, z }, molang)

                speedSound(p.distance)
            }
            moveSystem(drone, { location: drone.location, taskId: task, uniqueID: taskUniqueID, gonna: true, followEntity: true, updatePos: true, entity: p.entity, block: p.block, radius: 4, timer: 0 })
            return
        }
        else if (task === 8) {
            const { contA, contB } = JSON.parse(drone.getTags().find(f => { return f.includes('{"task":"') }) ?? '{}')
            let [ax, ay, az] = contA
            const [bx, by, bz] = contB

            const inventory = drone.getComponent("inventory").container
            p.emptyInv = inventory.size === inventory.emptySlotsCount

            const { iFilter } = JSON.parse(drone.getTags().find(f => { return f.includes('{"iFilter":[') }) ?? '{"iFilter":[]}')
            iFilter.forEach((f, i) => { if (!f.includes(":")) iFilter[i] = "minecraft:" + f })

            if (p.emptyInv) {
                moveSystem(drone, { location: { x: ax, y: ay, z: az }, taskId: task, uniqueID: taskUniqueID, iFilter, takeChestItem: true, timer: 0, })
                return
            }
            else {
                moveSystem(drone, { location: { x: bx, y: by, z: bz }, taskId: task, uniqueID: taskUniqueID, saveInv: true, timer: 0, })
                return
            }
        }
        else if (task === 9) {
            const { from, to, reload } = JSON.parse(drone.getTags().find(f => { return f.includes('{"task":"') }) ?? '{"chest":[]}')
            const [fx, fy, fz] = from ?? []
            const [tx, ty, tz] = to ?? []
            if (fz === undefined || tz === undefined) return

            if (!p.blocksList || (reload && p.blocksList && !p.blocksList[0])) {
                const blocks = []
                for (let x = Math.min(fx, tx); x <= Math.max(fx, tx); x++) {
                    for (let y = Math.min(fy, ty); y <= Math.max(fy, ty); y++) {
                        for (let z = Math.min(fz, tz); z <= Math.max(fz, tz); z++) {
                            const block = dimension.getBlock({ x, y, z })
                            if (!block || block.isAir || !block.isLiquid || block.permutation.getState("liquid_depth") != 0) continue
                            blocks.push({ x, y, z })
                        }
                    }
                }
                p.blocksList = blocks
            }
            else {
                const { x, y, z } = drone.location
                const blocks = []

                for (let i = -2; i <= 2; i++) {
                    for (let j = -2; j <= 2; j++) {
                        for (let k = -2; k <= 2; k++) {
                            const coords = { x: Math.floor(x) + i, y: Math.floor(y) + j, z: Math.floor(z) + k }
                            const block = dimension.getBlock(coords)
                            if (!block || block.isAir || !block.isLiquid || block.permutation.getState("liquid_depth") != 0 || !isCoordinateInsideRect(coords, { x: fx, y: fy, z: fz }, { x: tx, y: ty, z: tz })) continue
                            blocks.push(block.location)

                        }
                    }
                }
                if (!blocks[0]) p.blocksList = p.blocksList.sort(() => Math.random() - 0.5)

                let closestBlock = p.blocksList[0]
                let closestDistance = Infinity
                let i = 0

                for (const blockLocation of blocks[0] ? blocks : p.blocksList) {
                    const { x, y, z } = blockLocation
                    const block = dimension.getBlock({ x, y, z })
                    if (!block) { i++; continue }
                    if (!blocks[0] && (block.isAir || !block.isLiquid)) { p.blocksList.splice(i, 1); i++; continue }
                    if (!blocks[0]) {
                        closestBlock = blockLocation
                        break
                    }
                    const distance = calculateDistance(drone.location, blockLocation)
                    if (distance < closestDistance) {
                        closestDistance = distance
                        closestBlock = blockLocation
                    }
                    i++
                }
                if (!closestBlock && !reload && !p.blocksList[0]) {
                    deleteTasks(drone, undefined, true)
                    return
                }
                else if (!reload || closestBlock) {
                    moveSystem(drone, { location: closestBlock, taskId: task, uniqueID: taskUniqueID, blocksList: p.blocksList, removeLiquids: true, fromTo: { from: { x: fx, y: fy, z: fz }, to: { x: tx, y: ty, z: tz } }, timer: blocks[0] ? 0 : 40, })
                    return
                }
            }
        }
        else if (task === 10) {
            // Clone Structure Task
            const { scanArea, buildArea, blueprint, reload } = JSON.parse(drone.getTags().find(f => { return f.includes('{"task":"') }) ?? '{}')
            const [sx, sy, sz, ex, ey, ez] = scanArea ?? []
            const [bx, by, bz] = buildArea ?? []

            if (!p.blueprint && scanArea && !blueprint) {
                // Scan phase - record the structure
                const blocks = []
                for (let x = Math.min(sx, ex); x <= Math.max(sx, ex); x++) {
                    for (let y = Math.min(sy, ey); y <= Math.max(sy, ey); y++) {
                        for (let z = Math.min(sz, ez); z <= Math.max(sz, ez); z++) {
                            const block = dimension.getBlock({ x, y, z })
                            if (!block || block.isAir) continue
                            const relX = x - Math.min(sx, ex)
                            const relY = y - Math.min(sy, ey)
                            const relZ = z - Math.min(sz, ez)
                            blocks.push({
                                relX, relY, relZ,
                                typeId: block.typeId,
                                states: block.permutation.getAllStates()
                            })
                        }
                    }
                }
                p.blueprint = blocks
                drone.removeTag(drone.getTags().find(f => { return f.includes('{"task":"') }))
                drone.addTag(JSON.stringify({ task: `cStru`, taskID: 10, scanArea, buildArea, blueprint: blocks, reload }))
            }

            if (p.blueprint || blueprint) {
                const structureBlocks = p.blueprint || blueprint
                if (!p.buildList) {
                    p.buildList = structureBlocks.map(b => ({
                        x: bx + b.relX,
                        y: by + b.relY,
                        z: bz + b.relZ,
                        typeId: b.typeId,
                        states: b.states
                    }))
                }

                const inventory = drone.getComponent("inventory").container
                let targetBlock = p.buildList[0]

                for (let i = 0; i < p.buildList.length; i++) {
                    const block = p.buildList[i]
                    const existingBlock = dimension.getBlock({ x: block.x, y: block.y, z: block.z })
                    if (!existingBlock || (!existingBlock.isAir && existingBlock.typeId !== block.typeId)) {
                        p.buildList.splice(i, 1)
                        continue
                    }
                    if (existingBlock.isAir) {
                        targetBlock = block
                        break
                    }
                }

                if (!targetBlock && !reload) {
                    deleteTasks(drone, undefined, true)
                    return
                }

                if (targetBlock) {
                    moveSystem(drone, {
                        location: { x: targetBlock.x, y: targetBlock.y, z: targetBlock.z },
                        taskId: task,
                        uniqueID: taskUniqueID,
                        buildList: p.buildList,
                        placeStructureBlock: true,
                        targetBlock,
                        timer: 0
                    })
                    return
                }
            }
        }
        else if (task === 11) {
            // Fishing Task
            const { fishingSpot, catchContainer, fishingTime } = JSON.parse(drone.getTags().find(f => { return f.includes('{"task":"') }) ?? '{}')
            const [fx, fy, fz] = fishingSpot ?? []
            const [cx, cy, cz] = catchContainer ?? []

            if (!p.fishingPhase) p.fishingPhase = "moving"

            if (p.fishingPhase === "moving") {
                moveSystem(drone, {
                    location: { x: fx, y: fy + 1, z: fz },
                    taskId: task,
                    uniqueID: taskUniqueID,
                    startFishing: true,
                    timer: 0
                })
                return
            }
            else if (p.fishingPhase === "fishing") {
                if (!p.fishingTimer) p.fishingTimer = 0
                p.fishingTimer++

                // Simulate fishing - random chance to catch something
                if (p.fishingTimer > (fishingTime || 100) && Math.random() < 0.3) {
                    const fishItems = ["minecraft:cod", "minecraft:salmon", "minecraft:tropical_fish", "minecraft:pufferfish"]
                    const junkItems = ["minecraft:leather_boots", "minecraft:stick", "minecraft:bone"]
                    const treasureItems = ["minecraft:name_tag", "minecraft:saddle", "minecraft:enchanted_book"]

                    let caughtItem
                    const rand = Math.random()
                    if (rand < 0.7) caughtItem = fishItems[Math.floor(Math.random() * fishItems.length)]
                    else if (rand < 0.95) caughtItem = junkItems[Math.floor(Math.random() * junkItems.length)]
                    else caughtItem = treasureItems[Math.floor(Math.random() * treasureItems.length)]

                    dimension.spawnItem(new ItemStack(caughtItem, 1), drone.location)
                    drone.dimension.playSound("random.splash", drone.location)
                    p.fishingTimer = 0
                    p.caughtItems = (p.caughtItems || 0) + 1

                    if (cz && p.caughtItems >= 5) {
                        p.fishingPhase = "storing"
                        moveSystem(drone, {
                            location: { x: cx, y: cy, z: cz },
                            taskId: task,
                            uniqueID: taskUniqueID,
                            saveInv: true,
                            timer: 0
                        })
                        return
                    }
                }

                if (p.fishingTimer % 20 === 0) {
                    dimension.spawnParticle("minecraft:water_splash",
                        { x: fx + 0.5, y: fy + 0.1, z: fz + 0.5 },
                        new MolangVariableMap())
                }
            }
        }
        else if (task === 12) {
            // Illuminate Area Task
            const { lightArea, lightSource, spacing, chest } = JSON.parse(drone.getTags().find(f => { return f.includes('{"task":"') }) ?? '{}')
            const [lx1, ly1, lz1, lx2, ly2, lz2] = lightArea ?? []
            const [cx, cy, cz] = chest ?? []

            if (!p.lightPositions) {
                const positions = []
                const spaceGap = spacing || 7

                for (let x = Math.min(lx1, lx2); x <= Math.max(lx1, lx2); x += spaceGap) {
                    for (let y = Math.min(ly1, ly2); y <= Math.max(ly1, ly2); y += spaceGap) {
                        for (let z = Math.min(lz1, lz2); z <= Math.max(lz1, lz2); z += spaceGap) {
                            const groundY = findGroundLevel(dimension, x, y, z)
                            if (groundY !== -1) {
                                positions.push({ x, y: groundY + 1, z })
                            }
                        }
                    }
                }
                p.lightPositions = positions
            }

            const inventory = drone.getComponent("inventory").container
            const needsRefill = inventory.emptySlotsCount === inventory.size

            if (needsRefill && cz) {
                moveSystem(drone, {
                    location: { x: cx, y: cy, z: cz },
                    taskId: task,
                    uniqueID: taskUniqueID,
                    takeChestItem: true,
                    lightSource: lightSource || "minecraft:torch",
                    timer: 0
                })
                return
            }

            let targetPos = p.lightPositions[0]
            for (let i = 0; i < p.lightPositions.length; i++) {
                const pos = p.lightPositions[i]
                const block = dimension.getBlock(pos)
                if (block && block.isAir) {
                    targetPos = pos
                    break
                }
                p.lightPositions.splice(i, 1)
                i--
            }

            if (!targetPos) {
                deleteTasks(drone, undefined, true)
                return
            }

            moveSystem(drone, {
                location: targetPos,
                taskId: task,
                uniqueID: taskUniqueID,
                placeLightSource: true,
                lightSource: lightSource || "minecraft:torch",
                lightPositions: p.lightPositions,
                timer: 0
            })
        }
        else if (task === 92) {
            const { scanRadius: radius } = JSON.parse(drone.getTags().find(f => { return f.includes('{"scanRadius":') }) ?? `{}`)
            const anteOwner = JSON.parse(drone.getTags().find(f => { return f.includes('{"owner":') }) ?? `{"id":"0"}`)

            for (const dron of dimension.getEntities({ type: "effect99:drone", location: drone.location, maxDistance: radius ?? 16 })) {
                const owner = JSON.parse(dron.getTags().find(f => { return f.includes('{"owner":') }) ?? `{"id":"0"}`)
                if (owner.id != "0" && owner.id != anteOwner.id) continue
                dron.triggerEvent("walkMode")
            }
            const { x: dx, y: dy, z: dz } = drone.location
            dimension.spawnParticle(`antenna`, { x: dx, y: dy + 1.5, z: dz }, new MolangVariableMap())
        }
        else if (task === 93) {
            const { scanRadius: radius } = JSON.parse(drone.getTags().find(f => { return f.includes('{"scanRadius":') }) ?? `{}`)
            const anteOwner = JSON.parse(drone.getTags().find(f => { return f.includes('{"owner":') }) ?? `{"id":"0"}`)

            for (const dron of dimension.getEntities({ type: "effect99:drone", location: drone.location, maxDistance: radius ?? 16 })) {
                const owner = JSON.parse(dron.getTags().find(f => { return f.includes('{"owner":') }) ?? `{"id":"0"}`)
                if (owner.id != "0" && owner.id != anteOwner.id) continue
                dron.triggerEvent("flyMode")
            }
            const { x: dx, y: dy, z: dz } = drone.location
            dimension.spawnParticle(`antenna`, { x: dx, y: dy + 1.5, z: dz }, new MolangVariableMap())
        }
        else if (task === 94) {
            const { scanRadius: radius } = JSON.parse(drone.getTags().find(f => { return f.includes('{"scanRadius":') }) ?? `{}`)
            const anteOwner = JSON.parse(drone.getTags().find(f => { return f.includes('{"owner":') }) ?? `{"id":"0"}`)

            for (const dron of dimension.getEntities({ type: "effect99:drone", location: drone.location, maxDistance: radius ?? 16 })) {
                const owner = JSON.parse(dron.getTags().find(f => { return f.includes('{"owner":') }) ?? `{"id":"0"}`)
                if (owner.id != "0" && owner.id != anteOwner.id) continue
                deleteTasks(dron, undefined, true)
            }
            const { x: dx, y: dy, z: dz } = drone.location
            dimension.spawnParticle(`antenna`, { x: dx, y: dy + 1.5, z: dz }, new MolangVariableMap())
        }
        else if (task === 95) {
            const { container: [x, y, z] } = JSON.parse(drone.getTags().find(f => { return f.includes('{"task":"') }) ?? '{}')
            const { scanRadius: radius } = JSON.parse(drone.getTags().find(f => { return f.includes('{"scanRadius":') }) ?? `{}`)
            const anteOwner = JSON.parse(drone.getTags().find(f => { return f.includes('{"owner":') }) ?? `{"id":"0"}`)

            for (const dron of dimension.getEntities({ type: "effect99:drone", location: drone.location, maxDistance: radius ?? 16 })) {
                const owner = JSON.parse(dron.getTags().find(f => { return f.includes('{"owner":') }) ?? `{"id":"0"}`)
                if (owner.id != "0" && owner.id != anteOwner.id) continue

                deleteTasks(dron)
                system.runTimeout(() => {
                    dron.removeTag("RuntimeOut")
                    moveSystem(dron, { location: { x, y, z }, timer: 0, break: true, takeChestItem: true })
                }, 5)
            }
            const { x: dx, y: dy, z: dz } = drone.location
            dimension.spawnParticle(`antenna`, { x: dx, y: dy + 1.5, z: dz }, new MolangVariableMap())
        }
        else if (task === 96) {
            const { container: [x, y, z] } = JSON.parse(drone.getTags().find(f => { return f.includes('{"task":"') }) ?? '{}')
            const { scanRadius: radius } = JSON.parse(drone.getTags().find(f => { return f.includes('{"scanRadius":') }) ?? `{}`)
            const anteOwner = JSON.parse(drone.getTags().find(f => { return f.includes('{"owner":') }) ?? `{"id":"0"}`)

            for (const dron of dimension.getEntities({ type: "effect99:drone", location: drone.location, maxDistance: radius ?? 16 })) {
                const owner = JSON.parse(dron.getTags().find(f => { return f.includes('{"owner":') }) ?? `{"id":"0"}`)
                if (owner.id != "0" && owner.id != anteOwner.id) continue

                deleteTasks(dron)
                system.runTimeout(() => {
                    dron.removeTag("RuntimeOut")
                    moveSystem(dron, { location: { x, y, z }, timer: 0, break: true, saveInv: true })
                }, 5)
            }
            const { x: dx, y: dy, z: dz } = drone.location
            dimension.spawnParticle(`antenna`, { x: dx, y: dy + 1.5, z: dz }, new MolangVariableMap())
        }
        else if (task === 97) {
            const data = drone.getTags()
            const { coordinates: [x, y, z] } = JSON.parse(data.find(f => { return f.includes('{"task":"') }) ?? '{}')
            const { scanRadius: radius } = JSON.parse(data.find(f => { return f.includes('{"scanRadius":') }) ?? `{}`)
            const anteOwner = JSON.parse(data.find(f => { return f.includes('{"owner":') }) ?? `{"id":"0"}`)
            const { kamikaze } = JSON.parse(data.find(f => { return f.includes('{"task":"') }) ?? '{}')

            for (const dron of dimension.getEntities({ type: "effect99:drone", location: drone.location, maxDistance: radius ?? 16 })) {
                const owner = JSON.parse(dron.getTags().find(f => { return f.includes('{"owner":') }) ?? `{"id":"0"}`)
                if (owner.id != "0" && owner.id != anteOwner.id) continue

                deleteTasks(dron)
                system.runTimeout(() => {
                    dron.removeTag("RuntimeOut")
                    moveSystem(dron, { location: { x, y, z }, kamikaze, timer: 0, break: true, gonna: true })
                }, 5)
            }
            const { x: dx, y: dy, z: dz } = drone.location
            dimension.spawnParticle(`antenna`, { x: dx, y: dy + 1.5, z: dz }, new MolangVariableMap())
        }
        else if (task === 98) {
            const { scanRadius: radius } = JSON.parse(drone.getTags().find(f => { return f.includes('{"scanRadius":') }) ?? `{}`)
            const anteOwner = JSON.parse(drone.getTags().find(f => { return f.includes('{"owner":') }) ?? `{"id":"0"}`)

            for (const dron of dimension.getEntities({ type: "effect99:drone", location: drone.location, maxDistance: radius ?? 16 })) {
                const owner = JSON.parse(dron.getTags().find(f => { return f.includes('{"owner":') }) ?? `{"id":"0"}`)
                if (owner.id != "0" && owner.id != anteOwner.id) continue

                const inventory = dron.getComponent("inventory").container
                for (let i = 0; i < inventory.size; i++) {
                    const item = inventory.getItem(i)
                    if (inventory.emptySlotsCount === inventory.size) break
                    else if (!item) continue
                    dron.dimension.spawnItem(item, dron.location)
                    inventory.setItem(i, undefined)
                }
            }
            const { x, y, z } = drone.location
            dimension.spawnParticle(`antenna`, { x, y: y + 1.5, z }, new MolangVariableMap())
        }
        else if (task === 99) {
            const { x, y, z } = dimension.getBlock(drone.location)
            const chests = [{ x: x + 1, y, z }, { x: x - 1, y, z }, { x, y, z: z + 1 }, { x, y, z: z - 1 }]
            const { scanRadius: radius } = JSON.parse(drone.getTags().find(f => { return f.includes('{"scanRadius":') }) ?? `{}`)

            for (const vector of chests) {
                const chest = dimension.getBlock(vector)
                const container = (chest.getComponent("inventory") ?? { container: { size: 0 } }).container

                for (let i = 0; i < container.size; i++) {
                    const item = container.getItem(i)
                    if (container.emptySlotsCount === container.size) break
                    if (!item) continue
                    if (item.typeId === "minecraft:redstone" || item.typeId === "minecraft:lapis_lazuli") {
                        for (const dron of dimension.getEntities({ type: "effect99:drone", location: drone.location, maxDistance: radius ?? 16, excludeTags: ['{"battery":100}'] }).sort(() => Math.random() - 0.5)) {
                            const data = dron.getTags()
                            const battery = data.find(f => { return f.includes('{"battery":') }) ?? '{"battery":100}'
                            if (JSON.parse(battery).battery < 97) {
                                dron.removeTag(battery)
                                const max = Math.min(JSON.parse(battery).battery + 3, 100)
                                const batteryVal = max.toFixed()
                                dron.addTag(`{"battery":${batteryVal}}`)

                                const { dName, show } = JSON.parse(data.find(f => { return f.includes('{"dName":') }) ?? `{}`)
                                const { sttC, sttE } = JSON.parse(data.find(f => { return f.includes('{"sttA":') }) ?? `{}`)
                                if (show != 0 && sttE) {
                                    const { owner } = JSON.parse(data.find(f => { return f.includes('{"owner":') }) ?? `{}`)
                                    const { dLang } = JSON.parse(data.find(f => { return f.includes('{"dLang":') }) ?? '{"dLang":0}')
                                    let nameData = dName + (sttC ? `\n§7${translation(dLang, "owner")}: ${owner}` : ``) + (sttE ? `\n${batteryVal < 10 ? `§c` : `§a`}${translation(dLang, "batt")}: ${batteryVal}%` : ``)
                                    dron.nameTag = nameData
                                }

                                if (item.amount - 1 === 0) container.setItem(i, undefined)
                                else {
                                    item.amount -= 1
                                    container.setItem(i, item)
                                }
                                let molang = new MolangVariableMap()
                                molang.setSpeedAndDirection(`direction`, 2, { x: dron.location.x - drone.location.x, y: dron.location.y - 0.5 - drone.location.y, z: dron.location.z - drone.location.z })
                                dimension.spawnParticle(`drone_emitter`, { x: x + 0.5, y: y + 1.8, z: z + 0.5 }, molang)
                            }
                            break
                        }
                        break
                    }
                }
            }
        }
        else if (task === 100) {
            const tagTasks = drone.getTags().find(f => { return f.includes('{"task":"') }) ?? '{}'
            const anteOwner = JSON.parse(drone.getTags().find(f => { return f.includes('{"owner":') }) ?? `{"id":"0"}`)

            const { scanRadius } = JSON.parse(drone.getTags().find(f => { return f.includes('{"scanRadius":') }) ?? `{}`)
            for (const dron of dimension.getEntities({ type: "effect99:drone", tags: ['initSystem'], location: drone.location, maxDistance: scanRadius ?? 16 })) {
                if (dron.getTags().find(f => { return f.includes('{"task":"') })) continue

                const owner = JSON.parse(dron.getTags().find(f => { return f.includes('{"owner":') }) ?? `{"id":"0"}`)
                if (owner.id != "0" && owner.id != anteOwner.id) continue

                deleteTasks(dron)
                system.runTimeout(() => {
                    dron.addTag(tagTasks)
                    dron.getComponent('minecraft:mark_variant').value = drone.getComponent('minecraft:mark_variant').value
                    dron.addTag(JSON.stringify({ taskUniqueID: `${Math.random()}` }))
                    dron.removeTag("initSystem")
                }, 5)
            }
            const { x: dx, y: dy, z: dz } = drone.location
            dimension.spawnParticle(`antenna`, { x: dx, y: dy + 1.5, z: dz }, new MolangVariableMap())
        }
    }
    p.firstCall ? system.runTimeout(() => {
        p.firstCall = undefined
        p.uniqueID = taskUniqueID
        drone.removeTag("RuntimeOut")
        executeTasks(drone, task, p, runTime)
    }, 5)
        : executeTasks(drone, task, p, runTime)
}, p.firstCall ? 8 : runTime)

export function tasksEvents(drone, dimension, p = {}, o = {}) {
    if (p.tpPlayer && p.entity) {
        const { x, y, z } = drone.location
        const { x: tX, y: tY, z: tZ } = p.entity.location
        const distance = Math.sqrt(((x - 0.5) - tX) ** 2 + ((y - 0.5) - tY) ** 2 + ((z - 0.5) - tZ) ** 2)

        const { sttF = true, sttG = 15 } = JSON.parse(p.dTags?.find(f => { return f.includes('{"sttA":') }) ?? `{}`)
        if (sttF && distance >= sttG) {
            drone.teleport(p.location)
        }
    }
    if (p.followEntity && p.entity) {
        const { x, y, z } = drone.location
        const { x: tX, y: tY, z: tZ } = p.entity.location
        const distance = Math.sqrt(((x - 0.5) - tX) ** 2 + ((y - 0.5) - tY) ** 2 + ((z - 0.5) - tZ) ** 2)

        if (distance > (p.radius ?? 5)) {
            const { sttF = true } = JSON.parse(p.dTags?.find(f => { return f.includes('{"sttA":') }) ?? `{}`)
            moveSystem(drone, { location: p.entity.location, taskId: p.taskId, uniqueID: p.uniqueID, gonna: true, tpPlayer: sttF, radius: p.radius, entity: p.entity, updatePos: p.updatePos, timer: 0 })
            return true
        }
    }
    if (p.gonna && o.distance < (p.radius ?? 1.6)) {
        if (p.kamikaze) {
            dimension.createExplosion(drone.location, 5, { allowUnderwater: true, causesFire: true, source: drone })
            drone.kill()
            return true
        }
        executeTasks(drone, p.taskId, p)
        return true
    }
    else if (p.breakBlock && o.distance < 1.6) {
        const { bFilter } = JSON.parse(drone.getTags().find(f => { return f.includes('{"bFilter":[') }) ?? '{"bFilter":[]}')
        bFilter.forEach((f, i) => { if (!f.includes(":")) bFilter[i] = "minecraft:" + f })
        const block = dimension.getBlock({ x: o.targetX, y: o.targetY, z: o.targetZ })

        if ((bFilter[0] && !bFilter.includes(block.typeId)) || unbreakableBlocks.includes(block.typeId) || block.isAir || block.isLiquid) {
            drone.clearVelocity()
            executeTasks(drone, p.taskId, p)
            return true
        }
        else if (drone.runCommand(`setblock ${o.targetX} ${o.targetY} ${o.targetZ} air destroy`).successCount) {
            drone.playAnimation("animation.drone.drill_mode")
            drone.clearVelocity()
            executeTasks(drone, p.taskId, p)
            return true
        }
    }
    else if (p.placeBlock && o.distance < 1.6) {
        drone.clearVelocity()
        const inventory = drone.getComponent("inventory").container

        for (let i = 0; i < inventory.size; i++) {
            const item = inventory.getItem(i)
            const block = drone.dimension.getBlock({ x: o.targetX, y: o.targetY, z: o.targetZ })
            if (!item) continue
            if (!block || (!block.isAir && !block.isLiquid)) break
            try {
                if (p.grow && !harvestable.some(({ item: id }) => { return id === item.typeId })) throw new Error()

                const { block: placeable, event } = placeableItem.find((f, i) => { return f.typeId === item.typeId || i === placeableItem.length - 1 })
                if (event) event(drone.dimension, { x: o.targetX, y: o.targetY, z: o.targetZ })
                else {
                    drone.dimension.setBlockType({ x: o.targetX, y: o.targetY, z: o.targetZ }, placeable ?? item.typeId)
                    drone.dimension.playSound("dig.stone", { x: o.targetX, y: o.targetY, z: o.targetZ })
                }
                if (item.amount <= 1) {
                    inventory.setItem(i, `${placeable}`.includes("_bucket") ? new ItemStack("minecraft:bucket") : undefined)
                    drone.runCommand(`replaceitem entity @s slot.weapon.mainhand 0 air`)
                }
                else {
                    item.amount -= 1
                    inventory.setItem(i, item)
                    drone.runCommand(`replaceitem entity @s slot.weapon.mainhand 0 ${item.typeId}`)
                }
            } catch (e) {
                drone.dimension.spawnItem(item, drone.location)
                inventory.setItem(i, undefined)
            }
            executeTasks(drone, p.taskId, p)
            return true
        }
        drone.runCommand(`replaceitem entity @s slot.weapon.mainhand 0 air`)
        executeTasks(drone, p.taskId, p)
        return true
    }
    else if (p.takeChestItem && o.distance < 1.6) {
        const inventory = drone.getComponent("inventory").container
        if (inventory.size === inventory.emptySlotsCount) {
            const chest = drone.dimension.getBlock({ x: o.targetX, y: o.targetY, z: o.targetZ })
            if (!chest || !chest.getComponent("inventory")) { executeTasks(drone, p.taskId, p); return true }
            const container = chest.getComponent("inventory").container

            if (container.size != container.emptySlotsCount) {
                for (let i = 0; i < container.size; i++) {
                    const item = container.getItem(i)
                    if (!inventory.emptySlotsCount || !item) continue
                    if (!p.iFilter || !p.iFilter[0] || p.iFilter.includes(item.typeId)) {
                        inventory.addItem(item)
                        container.setItem(i, undefined)
                    }
                }
            }
            executeTasks(drone, p.taskId, p)
            return true
        }
        else {
            executeTasks(drone, p.taskId, p)
            return true
        }
    }
    else if (p.saveInv && o.distance < 1.7) {
        const inventory = drone.getComponent("inventory").container
        const chest = drone.dimension.getBlock({ x: o.targetX, y: o.targetY, z: o.targetZ })

        if (!chest || !chest.getComponent("inventory")) {
            p.finish = true
            executeTasks(drone, p.taskId, p)
            return true
        }
        const container = chest.getComponent("inventory").container
        if (container.emptySlotsCount) {
            for (let i = 0; i < inventory.size; i++) {
                const item = inventory.getItem(i)
                if (!container.emptySlotsCount || !item) continue
                container.addItem(item)
                inventory.setItem(i, undefined)
            }
        }
        p.finish = true
        executeTasks(drone, p.taskId, p)
        return true
    }
    else if (p.pickUp && o.distance < 1.1) {
        if (p.entity && p.entity.isValid) {
            if (p.entity.hasTag(`target`)) {
                p.entity.teleport(drone.location)
                p.entity.runCommand(`ride @s start_riding @e[type=effect99:drone,c=1] teleport_ride`)
                if (drone.getComponent('minecraft:skin_id').value === 2) {
                    p.entity.removeTag("target")
                    p.leaveMob = true
                }
            }
        }
        executeTasks(drone, p.taskId, p)
        return true
    }
    else if (p.pickUp && p.entity && p.entity.isValid && !p.entity.hasTag(`target`)) {
        p.skipID = p.entity.id
        executeTasks(drone, p.taskId, p)
        return true
    }
    else if (p.leaveMob && o.distance < 1.6) {
        drone.runCommand(`ride @s evict_riders`)
        drone.getComponent('minecraft:skin_id').value = 0
        p.leaveMob = false
        executeTasks(drone, p.taskId, p)
        return true
    }
    else if (p.leaveMob) {
        if (drone.getComponent('minecraft:skin_id').value === 0) {
            p.leaveMob = false
            executeTasks(drone, p.taskId, p)
            return true
        }
        else if (p.entity && p.entity.isValid) p.entity.removeTag("target")
    }
    else if (p.collectItem && o.distance < 1) {
        for (const entity of dimension.getEntities({ location: p.location, maxDistance: 1, type: "item" })) {
            let item = entity.getComponent("item").itemStack
            if (!p.iFilter || !p.iFilter[0] || p.iFilter.includes(item.typeId)) {
                const inventory = drone.getComponent("inventory").container
                if (inventory.emptySlotsCount) {
                    entity.remove()
                    inventory.addItem(item)
                }
            }
        }
        executeTasks(drone, p.taskId, p)
        return true
    }
    else if (p.removeLiquids && o.distance < 1) {
        const { x, y, z } = drone.location
        for (let j = -1; j <= 1; j++) {
            for (let i = -2; i <= 2; i++) {
                for (let k = -2; k <= 2; k++) {
                    const coords = { x: Math.floor(x) + i, y: Math.floor(y) + j, z: Math.floor(z) + k }
                    const block = dimension.getBlock(coords)
                    if (!block || block.isAir || !block.isLiquid || !isCoordinateInsideRect(coords, p.fromTo.from, p.fromTo.to)) continue
                    const isWater = block.typeId.includes("water")
                    drone.getComponent('minecraft:skin_id').value = (isWater ? 0 : 3)
                    block.setPermutation(BlockPermutation.resolve(isWater ? "minecraft:air" : "magma:broken"))
                }
            }
        }
        dimension.playSound("random.fizz", drone.location)
        dimension.spawnParticle("minecraft:explosion_manual", { x: x + 0.5, y: y + 0.5, z: z + 0.5 }, new MolangVariableMap())
        executeTasks(drone, p.taskId, p)
        return true
    }
    else if (!p.followEntity && p.radius && o.distance < p.radius) {
        if (p.reloadTask) { executeTasks(drone, p.taskId, p); return true }
        if (o.distance < 0.8) drone.clearVelocity()
        moveSystem(drone, p)
        return true
    }
    if (p.timer && p.timer > 50) {
        if (p.break) return true
        const { sttI } = JSON.parse(p.dTags?.find(f => { return f.includes('{"sttA":') }) ?? `{}`)
        if (sttI) {
            let blocks = [];
            const { x, y, z } = p.location
            const pBlock = dimension.getBlock({ x, y, z })
            if (pBlock && (pBlock.isAir || pBlock.isLiquid)) {
                blocks.push({ x, y: y + 0.5, z })
            }
            else {
                for (let i = -3; i <= 3; i++) {
                    for (let k = -3; k <= 3; k++) {
                        const locat = { x: Math.floor(x) + i, y: Math.floor(y), z: Math.floor(z) + k }
                        const block = dimension.getBlock(locat)
                        if (block && (block.isAir || block.isLiquid)) blocks.push(locat)
                    }
                }
            }
            if (blocks[0]) drone.teleport(blocks[Math.floor(Math.random() * blocks.length)], { checkForBlocks: true, keepVelocity: true })
        }
        executeTasks(drone, p.taskId, p)
        return true
    }
    else if (p.fishing && o.distance < 2) {
        drone.clearVelocity()

        // Check if there's water nearby
        const { x, y, z } = drone.location
        let waterFound = false
        for (let i = -2; i <= 2; i++) {
            for (let j = -1; j <= 1; j++) {
                for (let k = -2; k <= 2; k++) {
                    const block = dimension.getBlock({ x: Math.floor(x) + i, y: Math.floor(y) + j, z: Math.floor(z) + k })
                    if (block && block.typeId.includes("water")) {
                        waterFound = true
                        // Simulate fishing
                        if (Math.random() < 0.1) { // 10% chance to catch something
                            const fishTypes = ["minecraft:cod", "minecraft:salmon", "minecraft:tropical_fish", "minecraft:pufferfish"]
                            const randomFish = fishTypes[Math.floor(Math.random() * fishTypes.length)]
                            dimension.spawnItem(new ItemStack(randomFish, 1), drone.location)
                            dimension.playSound("random.splash", drone.location)
                        }
                        break
                    }
                }
                if (waterFound) break
            }
            if (waterFound) break
        }

        executeTasks(drone, p.taskId, p)
        return true
    }
    else if (p.illuminate && o.distance < 1.6) {
        drone.clearVelocity()
        const inventory = drone.getComponent("inventory").container

        for (let i = 0; i < inventory.size; i++) {
            const item = inventory.getItem(i)
            if (!item) continue

            if (item.typeId === p.torchType) {
                const block = dimension.getBlock({ x: o.targetX, y: o.targetY, z: o.targetZ })
                if (block && block.isAir) {
                    try {
                        dimension.setBlockType({ x: o.targetX, y: o.targetY, z: o.targetZ }, p.torchType)
                        dimension.playSound("dig.stone", { x: o.targetX, y: o.targetY, z: o.targetZ })

                        if (item.amount <= 1) {
                            inventory.setItem(i, undefined)
                        } else {
                            item.amount -= 1
                            inventory.setItem(i, item)
                        }
                        break
                    } catch (e) {
                        // Failed to place torch
                    }
                }
            }
        }

        executeTasks(drone, p.taskId, p)
        return true
    }
}



export function deleteTasks(drone, p = {}, ended) {
    const tagFilter = ["initSystem", "APD", "DCA", '{"sttA":', '{"owner":', '{"scanRadius":', '{"dName":"', '{"swarmID":"', '{"battery":', '{"dLang":']

    for (const dron of p.drones ?? [drone]) {
        dron.runCommand(`ride @s evict_riders`)
        dron.getComponent('minecraft:mark_variant').value = 0
        dron.getComponent('minecraft:skin_id').value = 0
        dron.runCommand(`replaceitem entity @s slot.weapon.mainhand 0 air`)

        for (const tag of dron.getTags()) {
            if (!tagFilter.some(f => { return tag.includes(f) })) {
                dron.removeTag(tag)
            }
        }
        if (ended) {
            const tagSett = dron.getTags().find(f => { return f.includes('{"sttA":') }) ?? `{}`
            let { sttA = "9", sttB } = JSON.parse(tagSett)
            sttA = sttA.match(/-?\d+/g)
            if (sttB && sttA.length === 3) {
                sttA.forEach((f, i) => { sttA[i] = parseInt(f) })
                const [x, y, z] = sttA

                system.runTimeout(() => {
                    dron.removeTag("RuntimeOut")
                    moveSystem(dron, { location: { x, y, z }, timer: 0, break: true, gonna: true })
                }, 10)
            }
        }
        dron.addTag("RuntimeOut")

        if (dron.getComponent('minecraft:variant').value === 2) return
        dron.triggerEvent("default")
    }
}

function isCoordinateInsideRect(location, from, to) {
    const { x: x1, y: y1, z: z1 } = from;
    const { x: x2, y: y2, z: z2 } = to;

    const isInsideX = isWithinRange(location.x, x1, x2);
    const isInsideY = isWithinRange(location.y, y1, y2);
    const isInsideZ = isWithinRange(location.z, z1, z2);

    function isWithinRange(value, min, max) {
        return value >= Math.min(min, max) && value <= Math.max(min, max);
    }
    return isInsideX && isInsideY && isInsideZ;
}

export function calculateDistance(p1, p2) {
    const dx = p2.x - p1.x
    const dy = p2.y - p1.y
    const dz = p2.z - p1.z
    return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

export const unbreakableBlocks = [
    "minecraft:bedrock",
    "minecraft:portal",
    "minecraft:end_portal",
    "minecraft:end_portal_frame"
]

const animalsList = [
    'minecraft:chicken',
    'minecraft:bee',
    'minecraft:cow',
    'minecraft:pig',
    'minecraft:sheep',
    'minecraft:wolf',
    'minecraft:polar_bear',
    'minecraft:ocelot',
    'minecraft:cat',
    'minecraft:mooshroom',
    'minecraft:bat',
    'minecraft:parrot',
    'minecraft:rabbit',
    'minecraft:llama',
    'minecraft:horse',
    'minecraft:donkey',
    'minecraft:mule',
    'minecraft:tropicalfish',
    'minecraft:cod',
    'minecraft:pufferfish',
    'minecraft:salmon',
    'minecraft:dolphin',
    'minecraft:turtle',
    'minecraft:panda',
    'minecraft:fox',
    'minecraft:squid',
    'minecraft:glow_squid',
    'minecraft:strider',
    'minecraft:goat',
    'minecraft:axolotl',
    'minecraft:allay',
    'minecraft:frog',
    'minecraft:tadpole',
    'minecraft:trader_llama',
    'minecraft:camel',
    'minecraft:armadillo',
    'minecraft:sniffer',
]

const aquaticMobsList = [
    'minecraft:squid',
    'minecraft:glow_squid',
    'minecraft:tropicalfish',
    'minecraft:cod',
    'minecraft:frog',
    'minecraft:pufferfish',
    'minecraft:salmon',
    'minecraft:dolphin',
    'minecraft:turtle',
    'minecraft:drowned',
    'minecraft:guardian',
    'minecraft:elder_guardian',
    'minecraft:axolotl',
    'minecraft:tadpole',
]

const flyMobsList = [
    'minecraft:vex',
    'minecraft:ender_dragon',
    'minecraft:wither',
    'minecraft:bat',
    'minecraft:parrot',
    'minecraft:allay',
    'minecraft:ghast',
    'minecraft:phantom',
    'minecraft:bee',
    'minecraft:breeze',
]

const excludeEntities = [
    "effect99:drone",
    "drone:target",
    "drone:laser",
    "minecraft:item",
    "minecraft:arrow",
    "minecraft:snowball",
    "minecraft:wind_charge_projectile",
    "minecraft:breeze_wind_charge_projectile",
    "minecraft:area_effect_cloud",
    "minecraft:egg",
    "minecraft:ender_pearl",
    "minecraft:eye_of_ender_signal",
    "minecraft:fireworks_rocket",
    "minecraft:fishing_hook",
    "minecraft:lightning_bolt",
    "minecraft:lingering_potion",
    "minecraft:llama_spit",
    "minecraft:shulker_bullet",
    "minecraft:thrown_trident",
    "minecraft:wither_skull",
    "minecraft:wither_skull_dangerous",
    "minecraft:fireball",
    "minecraft:small_fireball",
    "minecraft:xp_bottle",
    "minecraft:xp_orb",
]

const ores = [
    { typeId: "minecraft:iron_ore", id: 0 },
    { typeId: "minecraft:deepslate_iron_ore", id: 0 },

    { typeId: "minecraft:gold_ore", id: 1 },
    { typeId: "minecraft:deepslate_gold_ore", id: 1 },
    { typeId: "minecraft:nether_gold_ore", id: 1 },

    { typeId: "minecraft:diamond_ore", id: 2 },
    { typeId: "minecraft:deepslate_diamond_ore", id: 2 },

    { typeId: "minecraft:lapis_ore", id: 3 },
    { typeId: "minecraft:deepslate_lapis_ore", id: 3 },

    { typeId: "minecraft:redstone_ore", id: 4 },
    { typeId: "minecraft:deepslate_redstone_ore", id: 4 },
    { typeId: "minecraft:lit_deepslate_redstone_ore", id: 4 },
    { typeId: "minecraft:lit_redstone_ore", id: 4 },

    { typeId: "minecraft:coal_ore", id: 5 },
    { typeId: "minecraft:deepslate_coal_ore", id: 5 },

    { typeId: "minecraft:copper_ore", id: 6 },
    { typeId: "minecraft:deepslate_copper_ore", id: 6 },

    { typeId: "minecraft:emeral_ore", id: 7 },
    { typeId: "minecraft:deepslate_emeral_ore", id: 7 },

    { typeId: "minecraft:quartz_ore", id: 8 },

    { typeId: "minecraft:ancient_debris", id: 9 }
]

const sounds = [
    { sound: `random.toast`, volume: 0.3, pitch: 6 },
    { sound: `random.levelup`, volume: 1, pitch: 5 },
    { sound: `random.orb`, volume: 1, pitch: 5 }
]

const placeableItem = [
    { typeId: "minecraft:wheat_seeds", block: "minecraft:wheat" },
    { typeId: "minecraft:pumpkin_seeds", block: "minecraft:pumpkin_stem" },
    { typeId: "minecraft:melon_seeds", block: "minecraft:melon_stem" },
    { typeId: "minecraft:beetroot_seeds", block: "minecraft:beetroot" },
    { typeId: "minecraft:potato", block: "minecraft:potatoes" },
    { typeId: "minecraft:carrot", block: "minecraft:carrots" },
    { typeId: "minecraft:torchflower_seeds", block: "minecraft:torchflower_crop" },
    { typeId: "minecraft:pitcher_pod", block: "minecraft:pitcher_crop" },
    { typeId: "minecraft:sugar_cane", block: "minecraft:reeds" },
    { typeId: "minecraft:sweet_berries", block: "minecraft:sweet_berry_bush" },
    { typeId: "minecraft:lava_bucket", block: "minecraft:flowing_lava" },
    { typeId: "minecraft:water_bucket", block: "minecraft:flowing_water" },
    //{ typeId: "minecraft:bone_meal", event: growCrops, block: undefined },
    { block: undefined }
]

function growCrops(dimension, location) {
    dimension.spawnEntity("entity:bone_meal", location)
}

export const harvestable = [
    { item: "minecraft:wheat_seeds", block: "minecraft:wheat", level: 7, state: "growth" },
    { item: "minecraft:pumpkin_seeds", block: "minecraft:pumpkin", level: undefined, state: "growth" },
    { item: "minecraft:melon_seeds", block: "minecraft:melon_block", level: undefined, state: "growth" },
    { item: "minecraft:torchflower_seeds", block: "minecraft:torchflower", level: undefined, state: "growth" },
    { item: "minecraft:beetroot_seeds", block: "minecraft:beetroot", level: 7, state: "growth" },
    { item: "minecraft:potato", block: "minecraft:potatoes", level: 7, state: "growth" },
    { item: "minecraft:carrot", block: "minecraft:carrots", level: 7, state: "growth" },
    { item: "minecraft:sweet_berries", block: "minecraft:sweet_berry_bush", level: 3, state: "growth" },
    { item: "minecraft:pitcher_pod", block: "minecraft:pitcher_crop", level: 4, state: "growth" },
    { item: "minecraft:nether_wart", block: "minecraft:nether_wart", level: 3, state: "age" },
    { item: undefined, block: "minecraft:cocoa", level: 2, state: "age" },
]