import { Emitter, Event } from '../../../../base/common/event.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { TodoItem } from '../common/toolsServiceTypes.js';
import { TODO_STORAGE_KEY } from '../common/storageKeys.js';

export interface ITodoService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeTodos: Event<TodoItem[]>;
	getTodos(): TodoItem[];
	setTodos(todos: TodoItem[]): void;
	clear(): void;
}

export const ITodoService = createDecorator<ITodoService>('voidTodoService');

class TodoService implements ITodoService {
	readonly _serviceBrand: undefined;

	private readonly _onDidChangeTodos = new Emitter<TodoItem[]>();
	readonly onDidChangeTodos = this._onDidChangeTodos.event;

	constructor(
		@IStorageService private readonly storageService: IStorageService,
	) { }

	getTodos(): TodoItem[] {
		const raw = this.storageService.get(TODO_STORAGE_KEY, StorageScope.WORKSPACE)
		if (!raw) return []
		try {
			const parsed = JSON.parse(raw)
			return Array.isArray(parsed) ? parsed : []
		}
		catch { return [] }
	}

	setTodos(todos: TodoItem[]): void {
		this.storageService.store(TODO_STORAGE_KEY, JSON.stringify(todos), StorageScope.WORKSPACE, StorageTarget.MACHINE)
		this._onDidChangeTodos.fire(todos)
	}

	clear(): void {
		this.setTodos([])
	}
}

registerSingleton(ITodoService, TodoService, InstantiationType.Delayed);