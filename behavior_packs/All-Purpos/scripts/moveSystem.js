import { world, system } from "@minecraft/server"
import { tasksEvents } from "./executeTasks"

const validBlocks = new Set([
    "minecraft:tall_grass", 
    "minecraft:short_grass", 
    "minecraft:sea_grass", 
    "minecraft:kelp",
    "minecraft:snow_layer", 
    "minecraft:vine", 
    "minecraft:cave_vine", 
    "minecraft:rail",
    "minecraft:farmland"
])

export const moveSystem = (drone, p = {}, path = new Set(), rturn, rPath = new Set()) => system.runTimeout(() => {
    if (!drone || !drone.isValid || !p.location || drone.hasTag("RuntimeOut")) return
    const dTags = drone.getTags()
    if (JSON.parse(dTags.find(f => { return f.includes('{"battery":') }) ?? '{"battery":100}').battery <= 0) return
    let { x, y, z } = drone.location
    const dimension = drone.dimension
    p.dTags = dTags

    let { x: targetX, y: targetY, z: targetZ } = p.location
    const distance = Math.sqrt(((x - 0.5) - targetX) ** 2 + ((y - 0.5) - targetY) ** 2 + ((z - 0.5) - targetZ) ** 2)

    try {
        const block = dimension.getBlock({ x, y, z }).below(2)
        if (distance > 3 && block && block.isValid && !block.isAir && !block.isLiquid && !validBlocks.has(block.typeId)) targetY += 2
    } 
    catch (e) { }

    if (p.updatePos && (p.entity && p.entity.isValid)) p.location = p.entity.location
    else if (p.followPlayer) {
        const data = dTags.find(f => { return f.includes('{"followPlayer":t') })
        if (data) {
            for (const player of dimension.getPlayers()) {
                if (player.id === JSON.parse(data).playerID) {
                    let { x: px, y: py, z: pz } = player.location
                    let num = JSON.parse(data).swarm ? 5 : 0
                    p.location = { x: px + Math.floor(Math.random() * (Math.floor(Math.random() * 2) ? num : -num)), y: py + Math.floor(Math.random() * (Math.floor(Math.random() * 2) ? num : -num)), z: pz + Math.floor(Math.random() * (Math.floor(Math.random() * 2) ? num : -num)) }

                    const { sttF = true, sttG = 15 } = JSON.parse(dTags.find(f => { return f.includes('{"sttA":') }) ?? `{}`)
                    const pDistance = Math.sqrt(((x - 0.5) - px) ** 2 + ((y - 0.5) - py) ** 2 + ((z - 0.5) - pz) ** 2)
                    if (sttF && pDistance >= sttG) {
                        const rNum = Math.random() * (Math.floor(Math.random() * 2) ? 3 : -3)
                        drone.teleport({ x: px + rNum, y: py, z: pz + rNum })
                    }
                }
            }
        } else return
        if (tasksEvents(drone, dimension, p, { distance, targetX, targetY, targetZ })) return
    }
    if (p.followEntity) if (tasksEvents(drone, dimension, p, { distance, targetX, targetY, targetZ })) return
    if (p.timer && Math.floor(Math.random() * 8) === 0) p.timer++

    const inWalk = drone.getComponent("minecraft:variant").value
    const forceX = Math.sign(targetX - x)
    let forceY = inWalk ? 0 : Math.sign(targetY - y)
    const forceZ = Math.sign(targetZ - z)

    let yaw = Math.atan2(-(targetX - x), (targetZ - z)) * (180 / Math.PI)
    if (yaw < 0) yaw += 360
    drone.setRotation({ x: drone.getRotation().x, y: yaw })

    //world.getAllPlayers()[0].onScreenDisplay.setActionBar(`${distance.toPrecision(4)} - ${p.timer} - ${[targetX, targetY, targetZ]} - ${path.size}`)
    if (tasksEvents(drone, dimension, p, { distance, targetX, targetY, targetZ })) return
    let near = false
    if (distance <= 8) {
        near = true
    }
    x = Math.floor(x), y = Math.floor(y), z = Math.floor(z)
    if (isValidBlock({ x, y, z }, dimension) && !path.has(`${[x, y, z]}`)) { rPath.clear(); rturn = false }
    if ((!path.has(`${[x, y, z]}`) || (rturn && !rPath.has(`${[x, y, z]}`))) && `${[x, y, z]}` != `${[targetX, targetY, targetZ]}`) {
        rturn ? rPath.add(`${[x, y, z]}`) : path.add(`${[x, y, z]}`)
    }
    let valid = false
    let rNum = drone.isInWater ? 0.1 : 0.15
    const blockView = drone.getBlockFromViewDirection({ maxDistance: 1.5 })
    const velocity = drone.getVelocity()
    if (inWalk) {
        if (Math.abs(velocity.x) >= 0.3 || Math.abs(velocity.y) >= 0.3 || Math.abs(velocity.z) >= 0.3) {
            moveSystem(drone, p, path, rturn, rPath)
            return
        }
        rNum += 0.2
        if (blockView && !isValidBlock(blockView.block.location, dimension)) {
            forceY = 0.5
        }
    }
    if (!rturn && (!path.has(`${[x + forceX, y, z + forceZ]}`) || near) && isValidBlock({ x: x + forceX, y: y + forceY, z: z + forceZ }, dimension, Math.floor(Math.random() * 2) ? y : null)
        && (!blockView || isValidBlock(blockView.block.location, dimension))) {
        drone.applyImpulse({ x: forceX * rNum, y: inWalk ? forceY : forceY * rNum, z: forceZ * rNum })
        valid = true
        const epsilon = 0.1
        if (Math.abs(velocity.x) <= epsilon && Math.abs(velocity.y) <= epsilon && Math.abs(velocity.z) <= epsilon) valid = false
    }
    else if (inWalk && !isValidBlock({ x: x + forceX, y: y, z: z + forceZ }, dimension) && isValidBlock({ x: x + forceX, y: y + 1, z: z + forceZ }, dimension) && isValidBlock({ x: x, y: y + 1, z: z }, dimension)) {
        drone.applyImpulse({ x: 0, y: 0.5, z: 0 })
        valid = true
    }
    if (!valid) {
        if (typeof p.timer === "number") p.timer++
        let force
        searchPath()
        function searchPath(prior) {
            for (const { x: dx, y: dy, z: dz } of [{ x: 0, y: -1, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: 1 }, { x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }].sort(() => Math.random() - 0.5)) {
                if (inWalk && Math.abs(dy)) continue
                const block = { x: x + dx, y: y + dy, z: z + dz }
                if ((!path.has(`${[block.x, block.y, block.z]}`) || (rturn && !rPath.has(`${[block.x, block.y, block.z]}`) && prior)) && isValidBlock(block, dimension)) {
                    force = { x: dx * rNum, y: dy * rNum, z: dz * rNum }
                    break
                }
                if (!force && !prior) searchPath(true)
            }
        }
        try {
            if (Math.floor(Math.random() * 2) && velocity.x == 0 && velocity.y == 0 && velocity.z == 0 && dimension.getBlock({ x, y, z }).typeId != "minecraft:farmland") { drone.teleport({ x: x + 0.5, y, z: z + 0.5 }, { keepVelocity: true }) }
        } catch (e) { }
        if (force) drone.applyImpulse(force)
        if (!force && velocity.x == 0 && velocity.y == 0 && velocity.z == 0) {
            if (!rturn) {
                moveSystem(drone, p, path, true, rPath)
                return
            }
            else rPath.clear()
        }
    }
    if (path.size > 200) {
        let num = 0
        for (const f of path) {
            if (num >= 150) break
            path.delete(f)
            num++
        }
    }
    moveSystem(drone, p, path, rturn, rPath)
}, 3)

const isValidBlock = (vector, dimension, y) => {
    if (y != undefined) vector.y = y
    try {
        const block = dimension.getBlock(vector)
        if (!block || !block.isValid) return
        return block.isAir || block.isLiquid || validBlocks.has(block.typeId)
    } catch (e) { }
    return false
}

function visiblePaths(dimension, path, rPath) {
    for (const item of [...path]) {
        const [x, y, z] = item.split(",")
        dimension.spawnParticle("drone:propulsion", { x: parseInt(x) + 0.5, y: parseInt(y) + 0.5, z: parseInt(z) + 0.5 }, new MolangVariableMap())
    }
    for (const item of [...rPath]) {
        const [x, y, z] = item.split(",")
        dimension.spawnParticle("minecraft:endrod", { x: parseInt(x) + 0.5, y: parseInt(y) + 0.6, z: parseInt(z) + 0.5 }, new MolangVariableMap())
    }
}